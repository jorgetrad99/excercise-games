// Boxing tuning constants (Piece 4 design in PROGRESS.md). Units: s = seconds, "seg" = stamina pie
// segments (Wii Sports: 10 per boxer). Playtest and tune HERE.

export const boxingConfig = {
  /** Fixed tick, s (PLAN §3: 120 Hz). Gloves collide swept, so this sets timing precision, not tunneling. */
  fixedDt: 1 / 120,
  /** Half the distance between the boxers' spots, m (render/boxing/view places them here). */
  ring: { gapM: 0.78 },
  /**
   * Collision bodies, boxer-local m: +x = the boxer's left, +y up, +z toward the opponent, origin on the
   * floor under its neutral shoulder centre. Sized to what is drawn (render/boxing: big head ~0.31 m).
   */
  body: {
    head: [0, 1.66, 0.15] as const,
    headRadiusM: 0.3,
    /** Chest, below the big head's chin (~1.36 m): a rising glove reaches the chin before the chest. */
    torso: [0, 1.0, 0] as const,
    torsoRadiusM: 0.2,
    gloveRadiusM: 0.12,
    /** Left shoulder (right mirrors x): where a pose-driven arm is attached. */
    shoulder: [0.2, 1.42, 0.15] as const,
    /**
     * Player → boxer gains, m per player arm length (normalised by the player's calibrated arm, so any
     * body reaches the head at the same fraction of extension). Forward is larger: the Wii analog of a
     * glove that crosses the ring. At 1.3 a guard (wrist ~0.43 arm forward → z ≈ 0.71) stays ~29 cm short
     * of the face (z ≈ 0.99), and half the travel from guard to full extension lands ~4 cm into it.
     */
    armGainM: { forward: 1.3, side: 0.7, up: 0.7 },
    /** m per torso length of body sway / duck / rise (the player's lean moves the head this much). */
    leanGainM: 1.2,
    /** Assumed camera distance, m: PoseState `forward` is a fraction of it. */
    cameraDistanceM: 2.5,
    /** A pose sample older than this hands the boxer back to the keyboard/bot puppet, s. */
    staleS: 0.5,
    /** Pose samples arrive at 20–30 Hz: points are extrapolated along their velocity for at most this long
     *  past the newest sample, s (then held). Prediction instead of smoothing delay. */
    extrapolateS: 0.05,
    /** A contact ends once the glove is this much outside the touching distance, m (one hit per contact). */
    releaseM: 0.03,
    /**
     * A glove that touched something (or whiffed) re-arms once pulled back behind this boxer-local z, m.
     * Above a guard (z ≈ 0.71) and a ready stance (z ≈ 0.88) so returning to either re-arms; below the
     * face contact (z ≈ 0.99). Not a punch detector: it only stops one extension scoring twice.
     */
    recoverZ: 0.9,
  },
  /** Damage = base drain × clamp(closing speed / refSpeedMps, 0, maxMult). No minimum: a touch is a touch. */
  impact: { refSpeedMps: 5, maxMult: 1.5, bodyMult: 0.5 },
  phases: {
    /** "Round N… FIGHT!" before each round and after a pause, s. */
    introS: 3,
    resumeIntroS: 1.5,
    /** Round length, s (Wii: 180; shortened for full-body play, see PROGRESS). */
    roundS: 60,
    rounds: 3,
    /** Between rounds, s. */
    breakS: 4,
  },
  stamina: {
    segments: 10,
    /** Taken by a clean hit, seg. */
    clean: 0.7,
    /** Clean-hit multiplier inside the counter window after dodging a punch. */
    counterMult: 1.5,
    /** Counter window after a successful dodge, s. */
    counterWindowS: 0.8,
    /** Taken by a blocked hit, seg. */
    blocked: 0.15,
    /** Paid by the attacker when the punch is dodged, seg. */
    whiff: 0.3,
    /** Gained by the attacker for a clean hit, seg. */
    landedGain: 0.2,
    /** Regen after regenIdleS without punching or being hit, seg/s. */
    regenPerS: 0.5,
    regenIdleS: 1,
  },
  /**
   * Keyboard/bot puppet only (a pose-driven boxer's gloves are the player's): a key punch travels out
   * over travelS and back over retractS; whether and where it lands is collision.
   */
  punch: { travelS: 0.18, retractS: 0.3 },
  /** Puppet sway/duck: active for activeS, then can't be repeated for cooldownS; moves the head by m. */
  dodge: { activeS: 0.45, cooldownS: 0.2, swayM: 0.55, duckM: 0.55 },
  knockdown: {
    /** Fall (authority S4: the only state where the sim owns the whole rig) and get-up blend, s.
     *  Handovers are sim ticks (PLAN-BOXING §4), so the render reads these, not its own timings. */
    fallS: 0.7,
    riseS: 0.9,
    /** One referee count per this many s; 10 = KO. */
    countS: 0.8,
    /** Get-up count = base + perKnockdown·(n−1) + floor(span·rng); ≥ 10 means KO. */
    base: 2,
    perKnockdown: 3,
    span: 6,
    /** Max stamina lost per knockdown, seg (Wii: 2); never below minMax. */
    maxLoss: 2,
    minMax: 2,
    /** This many knockdowns suffered = TKO. */
    tko: 3,
  },
  bot: {
    /** Punch decision interval, s. */
    decideS: 0.1,
    /** Reaction time to an incoming glove, s (must be < punch.travelS to ever defend a key punch). */
    reactS: 0.08,
    /** The bot "sees" a punch once a glove closes on it faster than this, m/s (its perception only). */
    seeSpeedMps: 2,
    /** On reacting: guard / dodge probability (else nothing). */
    guardP: 0.55,
    dodgeP: 0.2,
    dizzyDodgeP: 0.7,
    /** Chance per decision to punch when free. */
    punchP: 0.15,
  },
};

export type BoxingConfig = typeof boxingConfig;
