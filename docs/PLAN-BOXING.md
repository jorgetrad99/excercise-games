# PLAN-BOXING — Boxing spec (control model, authority, knockdown, recovery, movement, trainer)

Status: **DRAFT, awaiting Jorge's sign-off** (2026-09-16). Nothing below is implemented yet.

## 0. Scope and precedence

- **This file is the source of truth for Boxing.** Until now, Boxing's rules lived only in the Phase 2 Piece 4 chat brief and in after-the-fact PROGRESS notes. `docs/PLAN.md` doesn't mention Boxing.
- **What it supersedes:** where this file conflicts with those notes or with `features.json` M7.6 / M7.11, this file wins. The rules it doesn't touch stay as built and documented in `docs/ARCHITECTURE.md` "Boxing":
  - punches and aim
  - guard and dodge
  - stamina and dizzy
  - TKO at 3 knockdowns
  - rounds and the decision
- **Verification:** each requirement has IDs (`BX-…`). Every test, screenshot and PROGRESS entry for this work cites the ID it verifies.
- **PLAN.md §6** (human-owned, so not edited here) frames running in place as jump noise. That's now game- and state-dependent: see §8. Proposed wording for Jorge is in §8.3.
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
  - whether a punch event lands, is blocked or whiffs
  - stamina, dizzy, knockdown, the count, getting up, KO/TKO
  - rounds, winner
  - position constraints (§2.3)
- **The sim never moves a player-owned channel,** except in the rows of §4 that name it and via the overlays of §2.2.
- **A rig/sim mismatch is expected, not a bug.** The rig can show a full straight that the sim didn't score (the fist was still recovering, or the motion missed the speed gate). The rig shows the body; sim events show the consequences (impact flash, pie, HUD, sound when there is audio).

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

- **Smoothing:** each channel eases toward its target with today's live-smoother τ (0.08 s, `render/boxing/live-pose.ts`), except where §4 says otherwise.
- **Anatomical and ring limits** are the only clamps.

### 2.2 Authorized sim overlays (closed list)

The sim may add to player-owned channels only these, bounded and time-limited. **Needs Jorge's explicit sign-off** (decision D1): the brief's table didn't list them, but without them a hit has no visible effect on the victim's body.

| ID | Overlay | Channels | Bound |
|---|---|---|---|
| O1 | Hit reaction: head snap away from the blow (UAL `Hit_Head` track) + root stagger | `head`, `root` | additive; ≤ 0.35 s per hit; head ≤ 0.5 rad; root ≤ 0.08 m |
| O2 | Stunned degradation (§4 row Stunned) | all body channels | only while `dizzy`, eased in/out τ 0.15 s |

### 2.3 Constraints (not animation, always on)

- **Facing:** each boxer's root yaw is locked toward the opponent. The player's torso yaw is relative to that.
- **Ring bounds:** root stays inside the ropes (square, `ring.halfM` = 2.2 m).
- **Separation:** root centers stay ≥ `ring.minSepM` = 0.7 m apart.
- **Placement reset:** at `intro` start, the anchor is re-centred so the player's calibrated stance maps to their start mark.

A constraint only clamps where a player-driven value lands. It never produces motion on its own.

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

## 4. Authority split (the contract)

- **Owner values:** `PLAYER` (§2.1 mapping), `SIM` (sim-driven clip/curve), `SCRIPT` (authored timeline, not a sim decision).
- **Handover instants:** every instant is a **sim tick** (fixed dt 1/60 s), so tests assert exact ticks.
- **The render never decides a handover.** It reads them from sim state through one pure function: `boxingAuthority(state, boxer) → { root, rootY, legs, hips, torso, head, arms, camera }`, each `'player' | 'sim' | 'script' | { blend }`. It lives in `src/games/boxing/authority.ts`, with no three.js.

| # | State (sim condition) | root / legs | torso / head / arms | camera (own slot) | Enters at (tick) | Test |
|---|---|---|---|---|---|---|
| S1 | **Intro** (`phase 'intro'`) | PLAYER (anchor reset §2.3) | PLAYER | behind-boxer | `phase` becomes `intro` | — (start) |
| S2 | **Neutral / combat** (`fight`, not dizzy) | PLAYER | PLAYER (+O1) | behind-boxer | `phase` becomes `fight` | BX-H-01 |
| S3 | **Stunned** (`fight`, `dizzy`) | PLAYER, degraded | PLAYER, degraded (+O1, O2) | behind-boxer + wobble | tick of `DIZZY` | BX-H-02 (in), BX-H-03 (out) |
| S4 | **Falling** (`down`, `phaseT < fallS`) | **SIM** (Death clip) | **SIM** | SIM (§5 fall camera) | tick of `KNOCKDOWN` | BX-H-04 |
| S5 | **On the canvas** (`down`, `phaseT ≥ fallS`, not rising) | canvas posture from effort (§6.4) | PLAYER | PLAYER head drives look (§5) | first tick with `phaseT ≥ fallS` | BX-H-05 |
| S6 | **Getting up** (`down.riseT ≠ null`) | blend canvas posture → PLAYER over `riseS` | PLAYER | blend → behind-boxer | tick of `RISE_START` | BX-H-06 |
| S7 | **Back in the fight** | as S2 | as S2 | behind-boxer | tick of `GET_UP` (`riseT ≥ riseS`) | BX-H-07 |
| S8 | **Walk to corner** (`break`, `breakT < walkS`) | SCRIPT (path to own corner) | PLAYER | behind-boxer, following | tick of `ROUND_END` (non-final) | BX-H-08 |
| S9 | **Corner with trainer** (`break`, seated) | SCRIPT (seated) | PLAYER | corner shot (§9) | first tick with `breakT ≥ walkS` | BX-H-09 |
| S10 | **Walk out** (`break`, last `walkS`) | SCRIPT (path to start mark) | PLAYER | behind-boxer | first tick with `breakT ≥ walkS + cornerS` | BX-H-10 |
| S11 | **Paused** (`paused`) | frozen at last rendered pose (nobody drives) | frozen | frozen | tick of `PAUSE` | BX-H-11 |
| S12 | **Over, winner / decision loser** | PLAYER | PLAYER | behind-boxer | tick of `MATCH_OVER` | BX-H-12 |
| S13 | **Over, KO/TKO loser** | as S5, recovery disabled | PLAYER | as S5 | tick of `MATCH_OVER` | BX-H-12 |

**Row details:**

- **S3 Stunned, degraded response:**
  - Live smoothing τ rises from 0.08 s to `stun.tauS` = 0.35 s.
  - Sway/arm amplitude is scaled by `stun.gain` = 0.6.
  - Locomotion speed is scaled by `stun.moveGain` = 0.4.
  - The existing wobble is added on top.
  - Degradation weight eases in and out with τ 0.15 s, so it fades and doesn't pop. This is today's `dizzyEaseS`, kept.
  - Punch events are ignored by the sim (existing rule); dodges still score.
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
  - The script is an authored path, not a sim outcome. The player's own lateral/forward movement is ignored until S10 ends.
  - Hops still lift `rootY` (PLAYER).

**Global invariants (tested):**

| ID | Invariant |
|---|---|
| BX-A-1 | Over a full scripted match covering every row, `boxingAuthority` returns `sim` for **all** channels only in S4, and for no channel outside S4 except O1/O2 overlays. |
| BX-A-2 | Every handover tick in the table is asserted exactly, both directions where a return exists (BX-H-01 … 12). |
| BX-A-3 | Same seed + same event log → identical `boxingAuthority` output per tick (determinism). |

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

- **Where they live:** a Boxing-owned classifier, `src/pose/recovery.ts`, with its own tuning block `gestureConfig.recovery`.
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

**Sim consequence — decision D2 (needs Jorge):**
- **(A, recommended)** Positions live in the sim. `MOVE` events are sampled at 10 Hz and quantized to 1 cm, so replays are deterministic.
  - A punch whose attacker–defender root distance > `move.reachM` = 1.1 m whiffs with no stamina change for either boxer.
  - The bot gains approach/retreat.
  - **Trade-off:** movement matters, but it's a real rules change (balance, bot, tests).
- **(B)** Positions are render-only.
  - **Trade-off:** cheap, but movement is decoration and punches land from across the ring.

| ID | Testable behavior |
|---|---|
| BX-MV-1 | Synthetic hip shift of +0.4 torso → root lateral +0.5 m (±1 cm) after smoothing settles; clamped at the ropes. |
| BX-MV-2 | Lateral step (hips + shoulders move together) → 0 `DODGE_*`. Lean (shoulders only) → `DODGE_*` as today, with existing sway tests unchanged. |
| BX-MV-3 | March at 2 steps/s, torso yaw 0 → anchor advances toward the opponent at 1.2 m/s (±10 %), stopping at `minSepM`. Yaw +30° → circles left. |
| BX-MV-4 | During an exchange (a fist `out`), locomotion speed = 0 and positional offset ≤ 0.15 m. |
| BX-MV-5 | Still fixture → root drift < 5 cm over its length. |
| BX-MV-6 | (If D2 = A) out-of-reach punch → `WHIFF`, both staminas unchanged; determinism test with `MOVE` events green. |

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
| S8–S10 | tracking, recalibrate (hops render only) |
| S11 | tracking |
| S12, S13 | Skate `jump` (play again from the results card, shell rule), tracking |

| ID | Testable behavior |
|---|---|
| BX-GS-1 | The march fixture replayed in S2 emits 0 `JUMP` and 0 recovery events. The same fixture in S5 emits recovery events and 0 `JUMP`. |
| BX-GS-2 | The Skate Run jump fixture and tests are unchanged and green (the Skate Run profile doesn't include `recovery`). |
| BX-GS-3 | The detector set is recomputed on the tick the state changes. The first S5 tick accepts recovery events; the last S4 tick doesn't. |

### 8.3 Proposed PLAN.md §6 wording (for Jorge to apply; the file is human-owned)

> **Jump false positives (bouncing while running in place)** | High | *Skate Run:* velocity gate + cooldown; playtest fixtures; consider requiring both hips to rise. *Boxing:* running/marching in place is **input**, not noise, in the knockdown state (PLAN-BOXING §6.3). Detectors are scoped per game and state (§8), so the Skate jump gate is never active there.

## 9. R4 — Trainer between rounds

- **Automatic, not player-initiated.** The break is rest for a tired body. Requiring a gesture adds a way to fail, and the stamina refill is a rule, not a choice.
- **Break length:** `breakS` goes from 4 to 11 s: `walkS` 2.0 → `cornerS` 7.0 → `walkS` 2.0. A full match grows by ~14 s.
- **Rules unchanged:** refill and dizzy clear still happen at `ROUND_END`.
- **Walk to corner (S8):** each boxer's root follows an authored path to its own corner (P1 red, P2 blue) with a walk cycle. The player's torso, head and arms stay live (§4).
- **Corner (S9):**
  - The boxer sits on a stool, facing the ring centre.
  - The trainer (a CC0 Quaternius character; `CREDITS.md` if not CC0) plays a scripted loop: towel, water bottle, talking.
  - The own-slot camera is a corner shot: 2.2 m out, eye level, trainer and boxer both framed.
  - The HUD shows "Round N in X s".
  - The player's head and torso move freely on the seated rig.
- **Walk out (S10):** path back to the start mark. It ends exactly on the tick the next round's `fight` begins.
- **Final round:** no corner; `MATCH_OVER` → S12/S13.
- **Puppets** do the same walk and corner.

| ID | Testable behavior |
|---|---|
| BX-TR-1 | `ROUND_END` tick → S8. `breakT = walkS` → S9. `breakT = walkS + cornerS` → S10. `phase 'fight'` tick → S2. Exact ticks. |
| BX-TR-2 | During S9, a synthetic head yaw of 0.4 rad → the rig head yaw is 0.4 rad (±0.02) after settling. Root doesn't move for synthetic hip shifts. |
| BX-TR-3 | No corner after the last round. Match length = 3 rounds + 2 × 11 s + intros (asserted in ticks). |
| BX-TR-4 | 2P: each boxer goes to its own corner; roots never cross `minSepM`. |

**Evidence:** screenshots at S8 mid-walk, S9 seated with the trainer (own slot and 2P), and S10. A video of one full break.

## 10. Acceptance mapping (Jorge's four criteria)

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

Until these exist, BX-RG-1…5 and BX-MV-2/5 run on synthetic poses and are marked **provisional** in `features.json`, the same as M7.10.

## 12. Open decisions (need Jorge before the step that uses them)

| ID | Question | Recommendation |
|---|---|---|
| D1 | Authorize overlays O1 (hit reaction) and O2 (stun degradation) on player-owned channels? | Yes. Without O1, being hit is invisible on your own boxer. |
| D2 | Movement positions in the sim with a reach rule (A), or render-only (B)? | A (§7). |
| D3 | Break length 11 s (+14 s per match) acceptable? | Yes, or shorten `cornerS` to 4 s (+8 s). |
| D4 | Arms free during S8–S10 (spec above) or scripted? | Free: it follows "the sim never takes the rig unless authorized". |

## 13. Work items (`features.json`)

M7.11 stays **done**: it delivered what it specified. New items:
- **M7.14** Control-model inversion: player owns the rig (§2–§4). BX-A-*, BX-CAL-*, BX-H-01…03, 11, 12.

  Note: BX-H-04…07 at M7.14 test today's count get-up; M7.16 re-points them at `RISE_START` / `GET_UP`.
- **M7.15** Player-perspective knockdown (§5). BX-KD-*, BX-H-04…07.
- **M7.16** Active recovery by effort (§6, §8). BX-RC-*, BX-RG-*, BX-GS-*.
- **M7.17** Free movement (§7). BX-MV-*. Blocked on D2.
- **M7.18** Trainer between rounds (§9). BX-TR-*, BX-H-08…10.

**Order:** M7.14 → merge → M7.15 + M7.16 → M7.17 → M7.18.
