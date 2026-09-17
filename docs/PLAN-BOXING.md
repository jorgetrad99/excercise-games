# PLAN-BOXING — Boxing spec (control model, authority, knockdown, recovery, movement, trainer)

Status: **D1–D5 decided by Jorge (2026-09-16); spec text awaiting final sign-off before M7.15.** Nothing below is implemented yet.

**D5 (Jorge, 2026-09-16, the original inversion brief) amends this spec in four places:**
1. **Punches score by glove collision** (§2.5), not by punch events and a speed gate.
2. **The rig predicts instead of easing** (§2.1).
3. **Calibration adds a body scan** in the menu, persisted per player name (§3, BX-CAL-6).
4. **The sim ticks at 1/120 s** (PLAN §3), not 1/60 s (§4).

Where older text in this file says otherwise, D5 wins.

## 0. Scope and precedence

- **This file is the source of truth for Boxing.** Until now, Boxing's rules lived only in the Phase 2 Piece 4 chat brief and in after-the-fact PROGRESS notes. `docs/PLAN.md` doesn't mention Boxing.
- **What it supersedes:** where this file conflicts with those notes or with `features.json` M7.6 / M7.11, this file wins. The rules it doesn't touch stay as built and documented in `docs/ARCHITECTURE.md` "Boxing":
  - ~~punches and aim~~: replaced by glove collision (D5, §2.5)
  - guard and dodge
  - stamina and dizzy
  - TKO at 3 knockdowns
  - rounds and the decision
- **Verification:** each requirement has IDs (`BX-…`). Every test, screenshot and PROGRESS entry for this work cites the ID it verifies.
- **PLAN.md §6** used to frame running in place as jump noise. That's now game- and state-dependent (§8). The row was reworded with Jorge's approval (§8.3).
- **Delivery order:**
  1. control-model inversion (§2–§4)
  2. then, blocked until 1 is merged, knockdown / recovery / movement / trainer (§5–§7, §9)

## 1. Reference behavior (Wii Sports Boxing)

Already captured by Piece 4 (research notes in PROGRESS "Phase 2, Piece 4"):
- per-hand punches with recovery
- guard, sway and duck
- a 10-segment pie
- dizzy
- the count to 10
- −2 max per knockdown
- 3 knockdowns = TKO
- 3 rounds, with a decision on points

**Missed by Piece 4, adopted here as the reference for getting up:**
- While knocked down, the player shakes/pumps the Wii Remote and Nunchuk, and that effort gets the Mii up before 10. No shaking means no getting up.
- Our body equivalent is §6. (Reference behavior as stated by Jorge, 2026-09-16; no source re-fetched for this file.)

**Deliberate differences from Wii:**
- Rounds are 60 s (full-body fatigue, PROGRESS Piece 4).
- The getting-up threshold is deterministic, where Wii has a hidden roll (§6.2).
- The boxers move around the ring (Wii keeps them planted; §7).
- The break is a corner visit with a trainer (§9).

## 2. Control model (the inversion)

**Rule: the player owns the rig; the sim resolves consequences.**

- **Rig:** the rendered boxer of a player whose input is a live `PoseState` (`src/pose/pose-state.ts`). By default, every rig channel is a function of that player's body.
- **Sim:** the deterministic core (`src/core/boxing/`). It decides only outcomes:
  - what a glove touched: hit, block or whiff (§2.5)
  - stamina, dizzy, knockdown, the count, getting up, KO/TKO
  - rounds, winner
  - position constraints (§2.3)
- **The sim never moves a player-owned channel,** except in the rows of §4 that name it and via the overlays of §2.2.
- **Rig and scoring read the same gloves (D5).** The sim scores the player's glove positions, so a glove drawn in the opponent's face was scored there. The remaining, intended mismatches:
  - A dizzy boxer's gloves touch without effect (existing rule: can't punch while dizzy).
  - One extension scores once: a glove held in the face, or one that slides from a guard into the face, scores nothing more until pulled back behind `body.recoverZ`.
  - The drawn glove is predicted up to `body.extrapolateS` ahead of the newest pose frame; hits use observed positions only (§2.1).

### 2.1 Rig channels

| Channel | Player-owned source (`PoseState`) | Mapping |
|---|---|---|
| `root` | hip-center offset from the calibrated stance + walk-in-place locomotion (§7) | ring position, clamped by §2.3 |
| `rootY` | `body.rise` (hop), `body.duck` | 1 torso length = rig torso length |
| `legs` | knees, when tracked (§3); otherwise a procedural stance/step cycle driven by the player's own `root` velocity | derived from the player, never from sim state |
| `hips` | `hips.rot` | direct |
| `torso` | `torso.rot`, `body.sway` | direct, **no ±6 cm / 0.35 rad clamps** (those are removed by the inversion) |
| `head` | `head.rot` | direct, anatomical clamp only (±1.2 rad yaw) |
| `armL`, `armR` | `arms[i].upperRot/foreRot`, `wrist` IK | direct, **no ±12 cm clamp, no sim punch clip** |
| `camera` (own slot) | follows `root` + `head` | §5 for knockdown |

- **No smoothing delay (D5).** The τ 0.08 s live smoother is removed. Measured on `12c1ddf`, it took the rig 200 ms to cover 90 % of a pose step (`boxing-latency.smoke`).
  - **Prediction instead:** each channel is drawn at the newest pose sample moved along its velocity by the time since that sample arrived, at most `body.extrapolateS` = 0.05 s, then held.
  - **Scoring doesn't predict:** extrapolating a fast glove past its last frame scored a jab that stopped 2 cm short.
  - **Jitter:** the landmark One Euro filter (M2) stays the only smoothing.
  - **Stun sluggishness** (O2's `slow(live)`) is an additive, bounded offset under §4.1, not channel easing.
- **Anatomical and ring limits** are the only clamps. Player → rig gains are fixed per axis (`body.armGainM`, `body.leanGainM`), normalised by the player's calibrated arm length (BX-CAL-6). They scale, but never clamp or gate.
- **Latency (BX-LAT-1):** camera frame → rendered glove is reported on every verify run, 1P and 2P (pipeline p50/p95 plus rig response to 90 % of a step). Report-only until Jorge sets the budget from the measured values.

### 2.2 Authorized sim overlays (closed list, D1 decided)

Authorized by Jorge (D1, 2026-09-16) under the §4.1 rule: each overlay is an **additive offset on top of the player's live pose**, never an override, and bounded in both magnitude and time.

- **Rig value:** `rig = live(player) + Σ offsets`. Each offset is clamped to its bound.
- **What's forbidden:** replacing, scaling, freezing or lagging the live value, and zeroing the player's contribution.

| ID | Overlay (additive offset) | Channels | Magnitude bound | Time bound |
|---|---|---|---|---|
| O1 | Hit reaction: head snap away from the blow (UAL `Hit_Head` track) + root stagger | `head`, `root` | head ≤ 0.5 rad; root ≤ 0.08 m | ≤ 0.35 s per hit, decays to 0 |
| O2 | Stunned: wobble + sluggishness offset (§4 row S3) | `hips`, `torso`, `head`, `armL`, `armR`, `root` | torso/hips/head ≤ 0.15 rad; each wrist ≤ 0.10 m; root ≤ 0.10 m | only while `dizzy`; eases in/out τ 0.15 s, 0 within 1 s of dizzy clearing |

### 2.3 Constraints (not animation, always on)

- **Facing:** each boxer's root yaw is locked toward the opponent. The player's torso yaw is relative to that.
- **Ring bounds:** root stays inside the ropes (square, `ring.halfM` = 2.2 m).
- **Separation:** root centers stay ≥ `ring.minSepM` = 0.7 m apart.
- **Placement reset:** at `intro` start, the anchor is re-centred so the player's calibrated stance maps to their start mark.

A constraint only clamps where a player-driven value lands. It never produces motion on its own.

### 2.5 Scoring by collision (D5)

- **Bodies in the sim:** each boxer has a head, torso and two gloves as spheres in its own frame (m).
  - **Pose boxers:** a `BODY` event per pose frame places them from the player's `PoseState` (arms via wrist IK × `armGainM`, head via sway/duck/forward × `leanGainM`).
  - **Puppets (§2.4):** key/bot punches, guard and dodges move the same spheres along authored paths.
- **Hit:** a glove sphere entering the defender's head or torso sphere, swept over the tick using motion relative to the target, so a fast glove can't pass through between ticks or pose frames. Only the side whose own motion did most of the closing strikes.
- **Block:** the glove enters one of the defender's gloves first.
- **Whiff:** the glove passes the front of the defender's head and turns back having touched nothing. It costs the attacker and opens the defender's counter window (existing rule).
- **Damage:** `clean × clamp(closing speed / impact.refSpeedMps, 0, impact.maxMult)`, × `impact.bodyMult` on the torso, × `counterMult` in the counter window. No minimum speed.
- **Zone** (bruises, O1 head snap): from the contact normal and the glove's own direction. A rising glove below the head's centre is the chin.
- **No punch detector:** `fists.ts` keeps only the guard posture classifier and the wrist-speed signal. `PUNCH_*` come from keyboard and bot only.
- **Bot perception:** the bot reacts to a glove closing on it faster than `bot.seeSpeedMps`. That's the bot's own perception, not a gate on the player.
- **§7 reach rule (M7.18):** with positions in the sim, "out of reach" is geometric (gloves can't get there). `move.reachM` becomes the bot's approach distance, not a whiff rule.

| ID | Testable behavior (`core/boxing/collide.spec.ts`) |
|---|---|
| BX-CL-1 | A short punch (half the guard → full extension travel) whose glove reaches the head volume is a `HIT` at 30, 25, 20, 15 and 10 pose-fps, for every sampling phase in which a pose frame observed the glove at the head. |
| BX-CL-2 | A glove stopping 2 cm short of the head: no event, at any rate (prediction never scores). |
| BX-CL-3 | Swept: a hook crossing the face between two pose frames 100 ms apart, with no frame inside the head, is a `HIT`. |
| BX-CL-4 | One hit per contact: a glove held in the face scores once; pulled back behind `recoverZ`, it can score again. |
| BX-CL-5 | A pose guard (gloves in front of the face) turns a straight into exactly one `BLOCK`. |
| BX-CL-6 | Keyboard rules still hold through geometry: straight hits, guard blocks, uppercut splits a guard, sway beats a straight (whiff + counter), a hook catches a sway into it, an uppercut catches a duck. |

### 2.4 Boxers without a body (puppets)

- **Which ones:** the 1P bot, `input=keyboard`, and `input=replay:` fixtures without pose frames.
- **How they're animated:** they have no `PoseState`, so the sim animates them fully in every state. This is today's behaviour, kept as the agent's harness.
- **Why this isn't a §4 violation:** no player body exists to be overridden.
- **Mixed input:** a boxer is a puppet iff `poses[i]` is `null` for > `puppetAfterMs` = 700 ms (same as TRACKING_LOST). Otherwise it follows §4.

## 3. Body calibration

Existing (`src/pose/calibration.ts`): stand still for `calibration.holdMs` = 2 s, drift < 0.08 torso. It captures `shoulderX, hipY, noseY, torsoLen, shoulderWidth`. The calibrated stance is the mirroring neutral.

Additions:

| ID | Requirement |
|---|---|
| BX-CAL-1 | Calibration also captures **`hipX`** (room centre for §7 positional mapping) and **`kneeY[L,R]`** when both knees are tracked (march reference, §6.3). `body.ts` must start tracking knees (MediaPipe 25, 26); today it doesn't. |
| BX-CAL-2 | **Framing check:** the calibration screen shows "step back so your knees are visible" while knees are untracked. Calibration still completes without knees; `MARCH_STEP` is then unavailable, and HOP and ARM_PUMP still count (§6.3). |
| BX-CAL-3 | **Rig scale:** player torso length ↦ rig torso length, so wrist IK and `rootY` are in rig metres. Already implied by `PoseState.wrist`; now also used for `root`. |
| BX-CAL-4 | **Recalibration** (`RECALIBRATE`) is accepted in `intro`, `fight`, `break` and `over`. It's **ignored while the boxer is down**: holding still would fight the recovery rule. |
| BX-CAL-5 | **Per player:** in 2P each player has their own calibration (existing). Tracking loss during a count pauses the match and freezes the count (existing PAUSE rule). |
| BX-CAL-6 | **Body scan (D5):** a menu option before a match. Stand still (existing calibration), then T-pose for 2 s.<br>• **Measures:** upper arm and forearm lengths (left/right) and shoulder width, in torso lengths; arms held side-on to the camera, so 2D lengths are true lengths.<br>• **Stored:** in `ProfileStore` under the player name (schema v1 → v2 migration; v1 profiles load with no scan).<br>• **Used for:** the bone lengths in `PoseState` depth reconstruction, and the arm length that normalises `armGainM`. So the scan changes effective reach: the same wrist image reads a different glove depth.<br>• **Default when skipped:** today's `gestureConfig.pose` bone lengths.<br>• **Tests:** a scan from synthetic T-pose frames measures the synthetic lengths (±3 %); the migration test; an e2e where a long-arm scan and the default map the same half-extension frames to a miss and a hit respectively. |

## 4. Authority split (the contract)

- **Owner values:** `PLAYER` (§2.1 mapping), `SIM` (sim-driven clip/curve), `SCRIPT` (authored timeline, not a sim decision).
- **Handover instants:** every instant is a **sim tick** (fixed dt 1/120 s, D5), so tests assert exact ticks.
- **The render never decides a handover.** It reads them from sim state through one pure function: `boxingAuthority(state, boxer) → { root, rootY, legs, hips, torso, head, arms, camera }`, each `'player' | 'sim' | 'script' | { blend }`. It lives in `src/games/boxing/authority.ts`, with no three.js.

| # | State (sim condition) | root / legs | torso / head / arms | camera (own slot) | Enters at (tick) | Test |
|---|---|---|---|---|---|---|
| S1 | **Intro** (`phase 'intro'`) | PLAYER (anchor reset §2.3) | PLAYER | behind-boxer | `phase` becomes `intro` | — (start) |
| S2 | **Neutral / combat** (`fight`, not dizzy) | PLAYER | PLAYER (+O1) | behind-boxer | `phase` becomes `fight` | BX-H-01 |
| S3 | **Stunned** (`fight`, `dizzy`) | PLAYER (+O2) | PLAYER (+O1, O2) | behind-boxer + wobble | tick of `DIZZY` | BX-H-02 (in), BX-H-03 (out) |
| S4 | **Falling** (`down`, `phaseT < fallS`) | **SIM** (Death clip) | **SIM** | SIM (§5 fall camera) | tick of `KNOCKDOWN` | BX-H-04 |
| S5 | **On the canvas** (`down`, `phaseT ≥ fallS`, not rising) | canvas posture from effort (§6.4) | PLAYER | PLAYER head drives look (§5) | first tick with `phaseT ≥ fallS` | BX-H-05 |
| S6 | **Getting up** (`down.riseT ≠ null`) | blend canvas posture → PLAYER over `riseS` | PLAYER | blend → behind-boxer | tick of `RISE_START` | BX-H-06 |
| S7 | **Back in the fight** | as S2 | as S2 | behind-boxer | tick of `GET_UP` (`riseT ≥ riseS`) | BX-H-07 |
| S8 | **Walk to corner** (`break`, `breakT < walkS`) | SCRIPT (path to own corner) | PLAYER | behind-boxer, following | tick of `ROUND_END` (non-final) | BX-H-08 |
| S9 | **Corner with trainer** (`break`, seated) | SCRIPT (seated) | PLAYER | corner shot (§9) | first tick with `breakT ≥ walkS` | BX-H-09 |
| S10 | **Walk out** (`break`, walking out) | SCRIPT path to start mark, **paced by the player's march** (§9) | PLAYER | behind-boxer | tick of the boxer's `WALK_OUT` (≥ `cornerMinS` into S9), or first tick with `breakT ≥ walkS + cornerS` | BX-H-10 |
| S11 | **Paused** (`paused`) | held at last rendered pose: tracking is lost, so no body exists to drive it (not sim ownership) | held | held | tick of `PAUSE` | BX-H-11 |
| S12 | **Over, winner / decision loser** | PLAYER | PLAYER | behind-boxer | tick of `MATCH_OVER` | BX-H-12 |
| S13 | **Over, KO/TKO loser** | as S5, recovery disabled | PLAYER | as S5 | tick of `MATCH_OVER` | BX-H-12 |

**Row details:**

- **S3 Stunned, degraded response (O2, additive only):**
  - **Sluggishness:** offset = `clamp(slow(live) − live, bound)`, where `slow` eases the live pose with `stun.tauS` = 0.35 s.
    - The rig trails a fast movement by at most the O2 bound, then catches up.
    - It is never a scaled or frozen copy of the player: the player always moves the part.
  - **Wobble:** the existing sway/roll wobble is added on the same channels, inside the same bound.
  - **Weight:** the O2 weight eases in and out with τ 0.15 s, so it fades and doesn't pop. This is today's `dizzyEaseS`, kept.
  - **Movement:** locomotion speed isn't scaled in the rig. The dizzy movement penalty is a sim rule (`stun.moveGain` = 0.4 on the `MOVE` walk speed, §7), so it's a consequence, not a rig override.
  - **Punches:** ignored by the sim (existing rule); dodges still score.
- **S3 → S2 (clinch break or bell):** the tick `dizzy` becomes false. Degradation eases out from that tick.
- **S4 Falling:**
  - The **only full-rig SIM state.** The existing Casual_Hoodie `Death` clip plays over `fallS` = 0.7 s.
  - From the last rendered player pose, the clip is blended in over its first `fallBlendS` = 0.12 s; the sim owns the blend weights.
  - A TKO enters S4 the same way, then goes to S13.
- **S5 On the canvas:**
  - Player channels ease in from the clip's end pose with τ 0.1 s, starting on the handover tick.
  - Effort events are accepted from this tick; during S4 they are ignored.
- **S6 Getting up:** only the base posture (root height, legs) is timed. The upper body stays the player's throughout.
- **S8–S10 (SCRIPT):**
  - Only `root` and `legs` are scripted.
  - The script is an authored path, not a sim outcome. `hips`, `torso`, `head` and both arms stay PLAYER (D4); hops still lift `rootY` (PLAYER).
  - The player's positional offset is ignored until S10 ends.
  - The player can end S9 early by walking out, and paces S10 (§9, D3).

### 4.1 General rule for sim effects on player-owned parts (Jorge, D1)

**Any sim effect on a player-owned channel, now or in future, must be:**
1. an **additive offset** on the live value, never an override (no replacing, scaling, freezing, lagging-by-substitution or zeroing)
2. **bounded in magnitude**
3. **bounded in time**, ending or decaying to 0

Anything else needs Jorge's explicit sign-off and a new row in §2.2. This is the door the old sim-authoritative model would come back through, so reviews check every new rig write against it.

**No frozen player states (D4):** outside S4, no row may stop a player-owned channel from following the live pose. S11 holds the pose only because no pose exists.

**Global invariants (tested):**

| ID | Invariant |
|---|---|
| BX-A-1 | Over a full scripted match covering every row, `boxingAuthority` returns `sim` for **all** channels only in S4, and for no channel outside S4 except O1/O2 overlays. |
| BX-A-2 | Every handover tick in the table is asserted exactly, both directions where a return exists (BX-H-01 … 12). |
| BX-A-3 | Same seed + same event log → identical `boxingAuthority` output per tick (determinism). |
| BX-A-4 | **Player still moves the parts under O1 + O2 at once.** A dizzy boxer takes a clean hit (O1 active, O2 at full weight). During the O1 window, synthetic live head yaw steps +0.6 rad, torso roll +0.4 rad and the left wrist +0.3 m forward. Asserted every tick: `|rig − live| ≤` the summed O1 + O2 bound per channel. After settling (≤ 0.5 s), each rig channel has moved by ≥ step − bound, in the step's direction. |
| BX-A-5 | **Offsets are time-bounded.** O1 offset is 0 on the first tick ≥ 0.35 s after the hit. O2 offset is < 1 % of its bound 1 s after `dizzy` clears. |
| BX-A-6 | **Rig writes go through the offset path.** `boxingRig(live, offsets)` is the only function that writes player-owned channels, and it has no branch that ignores `live` (unit test with `live` varied while offsets are held). |

## 5. R1 — Knockdown from the player's perspective

Today the knocked-down player sees their own boxer fall from the usual behind-the-back camera. The new behaviour, in the **downed player's own slot** (1P slot 0, or that player's half in 2P):

| ID | Testable behavior |
|---|---|
| BX-KD-1 | **S4 camera:** over `fallS` the slot camera moves from behind-boxer to the boxer's eye point (head bone + 0.1 m forward), riding the fall. |
| BX-KD-2 | **At the S5 handover tick:** eye height ≤ 0.6 m, pitch ≥ 30° above horizontal, and the opponent's head projects inside the viewport. |
| BX-KD-3 | **In S5 the player's own head yaw/pitch turns the view.** Player-owned, clamped ±0.6 rad around the look-up direction. |
| BX-KD-4 | **In S5 the count is shown large and centred.** A recovery meter shows `effort / need` and only moves when effort does (§6). |
| BX-KD-5 | **In S6 the camera blends back** and reaches the behind-boxer pose exactly on the `GET_UP` tick. |
| BX-KD-6 | **The other slot (2P), and the 1P view of a downed bot,** keep today's third-person view of the Death clip. |
| BX-KD-7 | **KO (S13):** the camera stays in the S5 view until the results card. |
| BX-KD-8 | **The dizzy wobble still fades and doesn't pop:** the existing `presentation.spec` cases stay green. |

**Evidence:** screenshots of own slot at S4 mid-fall, S5 handover, S5 mid-count with the meter at 0 and at ~50 %, S6 mid-rise, and `GET_UP`. The same instants from the opponent's slot in 2P. A Playwright video of one full knockdown → get-up.

## 6. R2 — Active recovery (effort drives getting up)

### 6.1 Rule

- **Getting up is earned by body effort during S5.** Nothing random and nothing time-based fills it.
- **No effort, no getting up:** a still player reaches count 10 and is KO'd.

### 6.2 Sim model (replaces `getUpAt = base + perKnockdown·(n−1) + floor(span·rng)`)

**State:** `down: { boxer, effort, need, idleT, riseT: number | null }`. `getUpAt` and its rng roll are **removed**.

- **Need:** `need = recovery.needBase × n`, where `n` is this boxer's knockdowns including this one.
  - The Nth knockdown needs N× the first's effort. With TKO at 3, n ∈ {1, 2}.
  - `needBase` = 6 effort points (untuned start value).
- **Effort events** (from §6.3, player-tagged) add points while the boxer is in S5:
  - `MARCH_STEP` +1.0
  - `HOP` +2.0
  - `ARM_PUMP` +0.5
- **Decay:** after `recovery.idleS` = 1.0 s without an effort event, `effort` drops by `recovery.decayPerS` = 0.5 points/s, never below 0. A still player therefore loses progress; they don't bank it.
- **Floor:** `RISE_START` fires on the first tick with `effort ≥ need` **and** `phaseT ≥ recovery.minDownS` = 2.0 s. Maximum effort can't get up sooner.
- **Rise:** `riseT` counts up; `GET_UP` fires at `riseT ≥ riseS` = 0.6 s → `phase 'fight'`. Max stamina −2 and refill both happen at `GET_UP` (existing rule).
- **Cap:** at `phaseT ≥ recovery.maxDownS` = 8.0 s (count 10 at 0.8 s/count), with `RISE_START` not fired → KO. A rise already started completes.
- **The referee count is display only:** `floor(phaseT / countS)`. It no longer decides anything.

**Tuning flag (Jorge):** at +0.5 per pump, the Wii reference mechanic (arm pumping) is the least efficient way up: 12 pumps vs 3 hops for knockdown 1. That may be intentional. Check it against the real `boxing-arm-pump` / `boxing-hop` recordings before shipping, and don't tune on synthetic poses.

**Expected pacing, for tuning later (not acceptance values):**
- **Marching at 2 steps/s** (2 pts/s): the 1st knockdown reaches `RISE_START` at `phaseT` ≈ 3.7 s (0.7 s fall + 3.0 s), the 2nd at ≈ 6.7 s. Both are under the 8.0 s cap.
- **March + arm pumps** (~4 pts/s): the 1st at ≈ 2.2 s (just above the 2.0 s floor), the 2nd at ≈ 3.7 s.

| ID | Testable behavior (sim unit tests, `core/boxing/sim.spec.ts`) |
|---|---|
| BX-RC-1 | No effort events after a knockdown → no `RISE_START`, `effort` stays 0, `MATCH_OVER` KO on the first tick with `phaseT ≥ 8.0`. |
| BX-RC-2 | Maximal effort (an event every tick) → `RISE_START` exactly on the first tick with `phaseT ≥ 2.0`, never earlier. |
| BX-RC-3 | The same constant effort rate takes strictly longer to reach `need` on knockdown 2 than on knockdown 1 (need ×2), with exact ticks asserted. |
| BX-RC-4 | Effort events during S4 (`phaseT < fallS`) add nothing. |
| BX-RC-5 | Effort then stillness: `effort` decays at 0.5/s after 1.0 s idle, never below 0. |
| BX-RC-6 | No rng is read on the knockdown path. Changing the seed doesn't change `RISE_START` / `GET_UP` ticks for the same event log. |
| BX-RC-7 | Pause during S5 freezes `phaseT`, `effort` and decay. |

### 6.3 Recovery gestures (state-scoped classifier)

- **Where they live:**
  - `MARCH_STEP` comes from a **shared, game-agnostic march classifier**, `src/pose/march.ts`. It emits steps (leg, time) and cadence, and nothing Boxing-specific.
  - The Skate Run amendment (step propulsion, drafted in another session, not started) consumes the same classifier. Its tuning lives in `gestureConfig.march`; games only choose when it's active (§8).
  - `HOP` and `ARM_PUMP` live in the Boxing recovery classifier `src/pose/recovery.ts` (`gestureConfig.recovery`). Its `HOP` is separate from Skate Run's `jump` gate (§8).
- **When it's active:** only while the player's boxer is in S5 (§8). Values below are untuned start values, torso-length units.

| Event | Detection | Refractory |
|---|---|---|
| `MARCH_STEP` | per knee: lift `(kneeY₀ − kneeY) / torso > 0.15`, re-armed when < 0.07 | 0.20 s per leg |
| `HOP` | `hipRise > 0.08` **and** `hipRiseVel > 0.8 /s` | 0.35 s |
| `ARM_PUMP` | per wrist: vertical stroke (reversal to reversal) with amplitude ≥ 0.25 | 0.15 s per wrist |

| ID | Testable behavior (fixture-driven, `src/pose/recovery.spec.ts`) |
|---|---|
| BX-RG-1 | **`boxing-still` fixture** (standing in stance, breathing, head movement, guard up): **0** events of any type over its whole length. |
| BX-RG-2 | **`boxing-march` fixture:** `MARCH_STEP` count within ±10 % of the human-counted steps, alternating legs. |
| BX-RG-3 | **`boxing-hop` fixture:** `HOP` count equals the human-counted hops; 0 `MARCH_STEP`. |
| BX-RG-4 | **`boxing-arm-pump` fixture:** `ARM_PUMP` count within ±10 % of the counted strokes. |
| BX-RG-5 | **End to end:** the still fixture replayed through a knockdown → KO. The march fixture → `RISE_START` before count 10. |
| BX-RG-6 | **Knees untracked (synthetic):** no `MARCH_STEP`, and HOP / ARM_PUMP are unaffected. |

**Puppet equivalents (agent harness):**
- **Keyboard:** `S` = `MARCH_STEP`, `H` = `HOP`, `A` = `ARM_PUMP`, each active only while down.
- **Bot:** emits `MARCH_STEP` every `bot.recoverStepS` = 0.5 s. Deterministic, no rng. It gets up on knockdown 1 and, at 2 pts/s, before the cap on knockdown 2.

### 6.4 Canvas posture follows effort

- **Posture:** the S5 base posture is sampled by `p = effort / need`: lying (0) → sitting (0.33) → one knee (0.66) → one knee, weight forward (1). It reads `effort`, so it never advances while the player is still, and it sinks back as effort decays.
- **Evidence:** screenshots at p = 0, 0.5, 1, and after decay.

## 7. R3 — Free movement (in place → ring displacement)

The player stands in front of a fixed camera with about ±0.5 m of usable floor. Two mappings combine:

1. **Positional (small moves, 1:k):**
   - Hip-centre offset from the calibrated `hipX` (lateral, torso units) and `body.forward` (depth) map to a root offset around the anchor.
   - Lateral: `move.lateralGainM` = 1.25 m per torso length. Depth: `move.depthGainM` = 5 m per unit of `forward` (20 % closer ≈ 1 m).
   - This moves the boxer continuously, the way the player moves.
2. **Walking in place (locomotion):** the standard VR "walking-in-place" technique.
   - **Speed:** `MARCH_STEP` cadence (steps/s over the last 1.0 s) sets `speed = min(move.maxMps 2.5, move.stepM 0.6 × cadence)`.
   - **Direction:** torso yaw relative to facing. 0 = toward the opponent; ±30° maps to ±90° (circle left/right). Back-pedalling = marching with the torso pitched back > 10°.
   - **Result:** the anchor moves, so the player can cover the ring without leaving their spot.
3. **Hop:** `rootY` follows `body.rise` (player-owned mirror). There's no sim rule for jumping.
4. **Sway vs step:** a dodge is the **lean of the shoulders relative to the hips**. The dodge detector switches from shoulder offset to (shoulder − hip) offset, so a side step moves the boxer instead of firing `DODGE_*`.
5. **Outside exchanges only:**
   - While either boxer has a fist not `ready`, or within `move.exchangeS` = 0.4 s after one returns, locomotion speed is 0.
   - Positional offset is still mirrored but clamped ±0.15 m.
   - You plant your feet to trade punches.

**Sim consequence — D2 decided: positions live in the sim, and out-of-reach punches whiff** (Jorge, 2026-09-16: player input must have real consequence).

- **Input:**
  - The pose layer turns §7.1–7.2 into `MOVE { player, offset: {x, z} (cm), walk: {speed (cm/s), heading (deg)} }`.
  - Sampled at 10 Hz, emitted only on change, quantized to 1 cm, 1 cm/s and 1°, so the event log replays deterministically.
- **Sim:**
  - Integrates each boxer's anchor from `walk` every tick and applies `offset`.
  - Applies §2.3 constraints (ropes, `minSepM`, facing) and the exchange rule (§7.5).
  - Applies `stun.moveGain` to walk speed while dizzy.
  - Position is sim state (`boxers[i].pos`).
- **Render:** the root eases toward the sim position (τ 0.08 s). Added latency ≈ ≤ 100 ms sampling + one tick, measured by the existing camera→glove latency e2e.
- **Reach rule:**
  - A punch landing (`travelS` after it's thrown) when attacker–defender distance > `move.reachM` = 1.1 m is a `WHIFF`.
  - **Superseded by D5 (§2.5):** with collision scoring, reach is geometric: a glove that can't get to the head doesn't touch it. `move.reachM` is kept only as the bot's approach distance. BX-MV-6 becomes "at 1.2 m the same punch touches nothing; at 1.0 m it hits".
  - No stamina change for either boxer, and no counter window: the defender didn't dodge.
- **Keyboard puppet:** `I`/`K` walk toward/away, `J`/`L` strafe (the arrows stay dodges).

**What D2 changes for the bot** (`core/boxing/bot.ts`; still stateless and deterministic, `rngAt` only):
- **Approach:** the bot moves to `reachM − 0.15` m before punching and punches only inside reach. Walk speed cap `bot.moveMps` = 1.5 m/s, below the player's 2.5 m/s, so a player can out-walk it. It obeys the exchange rule.
- **Retreat:** when stamina < 3 segments and not dizzy, it backs out to `reachM + 0.3` m and regenerates.
- **Defence unchanged:** it still reacts to thrown punches 0.08 s after they leave (guard/sway), and doesn't react to punches thrown from out of reach.
- **Balance risk, kiting:** a player can retreat to regen indefinitely. The small ring (±2.2 m) and the bot's approach limit it. BX-MV-7 measures it, and there's no anti-kite rule until that shows a problem.
- **Tests to re-baseline, not delete:**
  - bot-vs-bot match length and result distribution in `sim.spec.ts` (old vs new values recorded in PROGRESS)
  - the 1P e2e screenshot baselines (boxers no longer at fixed marks)

| ID | Testable behavior |
|---|---|
| BX-MV-1 | Synthetic hip shift of +0.4 torso → root lateral +0.5 m (±1 cm) after smoothing settles; clamped at the ropes. |
| BX-MV-2 | Lateral step (hips + shoulders move together) → 0 `DODGE_*`. Lean (shoulders only) → `DODGE_*` as today, with existing sway tests unchanged. |
| BX-MV-3 | March at 2 steps/s, torso yaw 0 → anchor advances toward the opponent at 1.2 m/s (±10 %), stopping at `minSepM`. Yaw +30° → circles left. |
| BX-MV-4 | During an exchange (a fist `out`), locomotion speed = 0 and positional offset ≤ 0.15 m. |
| BX-MV-5 | Still fixture → root drift < 5 cm over its length. |
| BX-MV-6 | Out-of-reach punch (distance 1.2 m) → `WHIFF`, both staminas unchanged, no counter window. The same punch at 1.0 m → `HIT`. Determinism test with a `MOVE`-heavy event log green. |
| BX-MV-7 | Bot vs scripted kiter (walks away at 2.5 m/s whenever the bot is within 1.3 m): the bot still lands ≥ 1 clean hit per round over seeds 1–20. The value is recorded; below that, the kiting balance question goes to Jorge. |
| BX-MV-8 | Dizzy boxer: sim walk speed = 0.4 × input speed. Rig root lags the live offset by ≤ the O2 root bound, never more (additive rule, §4.1). |

## 8. Gesture scoping by game and state

### 8.1 Rule

- **Each game declares which detectors run, per player, as a pure function of its sim state:** `MiniGame.activeGestures(state, player): DetectorSet`.
- **The engine runs only that set.** State-scoped, never a global flag.
- **Skate Run's `detectJumpAndGrab`** (velocity gate 1.2 torso/s + 500 ms cooldown, `gestureConfig.jump`) stays exactly as is and is **never active in Boxing S5**.

### 8.2 Boxing detector sets

| Boxing state | Active detectors |
|---|---|
| S1, S2, S3 | fists (punch/guard), dodge (lean vs hips, §7.4), duck, march (locomotion cadence), recalibrate, tracking |
| S4 | tracking only |
| S5, S6 | **recovery** (`MARCH_STEP`, `HOP`, `ARM_PUMP`), guard, tracking |
| S8–S10 | march (`WALK_OUT` in S9, pace in S10), tracking, recalibrate (hops render only) |
| S11 | tracking |
| S12, S13 | Skate `jump` (play again from the results card, shell rule), tracking |

| ID | Testable behavior |
|---|---|
| BX-GS-1 | The march fixture replayed in S2 emits 0 `JUMP` and 0 recovery events. The same fixture in S5 emits recovery events and 0 `JUMP`. |
| BX-GS-2 | The Skate Run jump fixture and tests are unchanged and green (the Skate Run profile doesn't include `recovery`). |
| BX-GS-3 | The detector set is recomputed on the tick the state changes. The first S5 tick accepts recovery events; the last S4 tick doesn't. |

### 8.3 PLAN.md §6 wording (approved by Jorge 2026-09-16, applied to PLAN.md)

> **Jump false positives (bouncing while running in place)** | High | *Skate Run:* velocity gate + cooldown; playtest fixtures; consider requiring both hips to rise. *Boxing:* running/marching in place is **input**, not noise, in the knockdown state (PLAN-BOXING §6.3). Detectors are scoped per game and state (§8), so the Skate jump gate is never active there.

## 9. R4 — Trainer between rounds

- **Going to the corner is automatic; leaving it is up to the player (D3).** Nothing is required to rest. A player who wants to fight sooner can end the break by walking back out.
- **Break length:** up to 11 s: `walkS` 2.0 → `cornerS` 7.0 → `walkS` 2.0. It's interruptible, so the real cost is 2.0 + `cornerMinS` + walk-out ≈ 6 s minimum and 11 s maximum per break.
- **Walking out early (D3):**
  - **Trigger:** `WALK_OUT` from the shared march classifier (§6.3): cadence ≥ 1.5 steps/s sustained 1.0 s. With knees untracked, a step toward the camera (`body.forward ≥ 0.15`) held 0.5 s.
  - **Timing:** accepted from `cornerMinS` = 2.0 s into S9 (the trainer beat always plays); earlier `WALK_OUT` is ignored.
  - **Walk-out pace:** S10 path progress speed = `max(walk.minMps 0.8, player march speed)`, so marching faster gets you out faster and standing still still finishes.
  - **Next round** starts on the tick the **last** boxer reaches their start mark (2P: both must walk out or time out), or at the 11 s cap, whichever is first.
  - **1P bot:** it waits and walks out on the same tick as the player, or at the cap.
  - **Keyboard puppet:** `W` = `WALK_OUT`.
- **Rules unchanged:** refill and dizzy clear still happen at `ROUND_END`.
- **Walk to corner (S8):** each boxer's root follows an authored path to its own corner (P1 red, P2 blue) with a walk cycle. The player's torso, head and arms stay live (§4).
- **Corner (S9):**
  - The boxer sits on a stool, facing the ring centre.
  - The trainer (a CC0 Quaternius character; `CREDITS.md` if not CC0) plays a scripted loop: towel, water bottle, talking.
  - The own-slot camera is a corner shot: 2.2 m out, eye level, trainer and boxer both framed.
  - The HUD shows "Round N in X s".
  - The player's head and torso move freely on the seated rig.
- **Walk out (S10):** path back to the start mark, paced as above. The next round's `fight` begins on the tick the last boxer arrives.
- **Final round:** no corner; `MATCH_OVER` → S12/S13.
- **Puppets** do the same walk and corner.

| ID | Testable behavior |
|---|---|
| BX-TR-1 | No walk-out input: `ROUND_END` tick → S8. `breakT = walkS` → S9. `breakT = walkS + cornerS` → S10. `phase 'fight'` tick → S2. Exact ticks. |
| BX-TR-2 | During S9, a synthetic head yaw of 0.4 rad → the rig head yaw is 0.4 rad (±0.02) after settling. Root doesn't move for synthetic hip shifts. |
| BX-TR-3 | No corner after the last round. With no walk-out input, match length = 3 rounds + 2 × 11 s + intros (asserted in ticks). |
| BX-TR-4 | 2P: each boxer goes to its own corner; roots never cross `minSepM`. |
| BX-TR-5 | `WALK_OUT` at S9 + 3.0 s → S10 on that exact tick. `fight` begins on the tick the path completes at the paced speed, earlier than the no-input case. |
| BX-TR-6 | `WALK_OUT` at S9 + 1.9 s is ignored (still S9 at S9 + 2.0 s). A sustained march crossing 2.0 s fires on the first tick ≥ `cornerMinS`. |
| BX-TR-7 | 2P: P1 walks out at S9 + 2.5 s, P2 doesn't. The round starts only when P2's timed walk-out ends (cap), and P1 waits at the start mark with all channels PLAYER. |
| BX-TR-8 | Still fixture replayed through a break → no `WALK_OUT`, full 11 s. March fixture → `WALK_OUT` (provisional until the fixture exists). |

**Evidence:** screenshots at S8 mid-walk, S9 seated with the trainer (own slot and 2P), and S10. A video of one full break.

## 10. Acceptance mapping (Jorge's four criteria)

0. **Jorge's inversion brief (D5):** a short punch that reaches the head hits (BX-CL-1); the body moves the rig continuously (BX-A-1, BX-A-4); no sim override outside authorized states (BX-A-1, BX-A-6); end-to-end latency measured every run (BX-LAT-1); calibration in the menu changes effective reach (BX-CAL-6).
1. **A test per authority transition at the exact handover tick:** BX-H-01 … BX-H-12 (`src/games/boxing/authority.spec.ts`), BX-TR-1, BX-GS-3.
2. **No state outside Falling where the sim owns the full rig:** BX-A-1.
3. **Recovery doesn't progress while still:** BX-RC-1, BX-RC-5, BX-RG-1, BX-RG-5, and the §6.4 posture screenshot after decay.
4. **Screenshots/recordings of every new animation:** §5, §6.4 and §9 evidence lists. Stored under `tmp/boxing-spec/`, paths cited in PROGRESS. Taken with `?game=boxing&seed=42&debug=1` on synthetic pose (`input=replay:` with pose frames), and puppet keyboard where noted.

**Can't be automated (playtest for Jorge):**
- whether the effort needed feels fair
- whether the first-person fall is disorienting
- whether walking in place is comfortable for 3 rounds

## 11. Fixtures Jorge needs to record (human-owned `fixtures/pose/boxing/`)

Each is 10–15 s, `?record=1`, full body with knees visible, after calibration:
- `boxing-still.json`: stance, guard up, breathing, small head turns, no steps
- `boxing-march.json`: march in place ~2 steps/s; say the step count
- `boxing-hop.json`: hop in place; count them
- `boxing-arm-pump.json`: pump both arms up and down; count them
- `boxing-side-step.json`: step left/right and back, no lean (for BX-MV-2)

Until these exist, BX-RG-1…5, BX-MV-2/5 and BX-TR-8 run on synthetic poses and are marked **provisional** in `features.json`, the same as M7.10. **No threshold is tuned on synthetic poses.**

These are sustained-posture and gesture classifiers (march, hop, arm pump, side step), so they survive the inversion. The punch thresholds are the ones the inversion removes from the rig path.

## 12. Decisions

| ID | Question | Decision (Jorge, 2026-09-16) |
|---|---|---|
| D1 | Authorize overlays O1 (hit reaction) and O2 (stun degradation) on player-owned channels? | **Yes, as additive, bounded, time-limited offsets only**, with a test that the player still moves the parts (BX-A-4). This becomes the general rule in §4.1. |
| D2 | Movement positions in the sim with a reach rule (A), or render-only (B)? | **A.** Accept the balance, bot and test cost; bot changes are listed in §7. |
| D3 | Break length 11 s (+14 s per match) acceptable? | **Keep 11 s, but interruptible:** the player ends the corner early by walking out (§9). |
| D4 | Arms free during S8–S10 (spec above) or scripted? | **Free.** Any frozen player state is a regression toward sim ownership (§4.1). |
| D5 | Where the inversion brief and this draft disagree: punch scoring, smoothing, calibration, tick rate | **The brief:** glove collision (§2.5), prediction with no easing (§2.1), body scan in the menu persisted per name (BX-CAL-6), 1/120 s ticks. |

## 13. Work items (`features.json`)

M7.11 stays **done**: it delivered what it specified. IDs follow the renumbering on `feat/player-authority` (mapping in PROGRESS). New items:
- **M7.15** Control-model inversion: player owns the rig (§2–§4). BX-A-*, BX-CAL-*, BX-CL-*, BX-LAT-1, BX-H-01…03, 11, 12.

  Note: BX-H-04…07 at M7.15 test today's count get-up; M7.17 re-points them at `RISE_START` / `GET_UP`.
- **M7.16** Player-perspective knockdown (§5). BX-KD-*, BX-H-04…07.
- **M7.17** Active recovery by effort (§6, §8). BX-RC-*, BX-RG-*, BX-GS-*.
- **M7.18** Free movement with sim positions and reach (§7). BX-MV-*.
- **M7.19** Trainer between rounds, interruptible (§9). BX-TR-*, BX-H-08…10.

**Order:** M7.15 → merge → M7.16 + M7.17 → M7.18 → M7.19.
