// Boxing tuning constants (Piece 4 design in PROGRESS.md). Units: s = seconds, "seg" = stamina pie
// segments (Wii Sports: 10 per boxer). Playtest and tune HERE.

export const boxingConfig = {
  /** Fixed tick, s. Boxing has no fast-moving geometry: 60 Hz is plenty. */
  fixedDt: 1 / 60,
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
  /** A punch reaches the opponent after travelS; the fist is busy until retractS more (the Wii
   *  "wait until the glove stops"). */
  punch: { travelS: 0.18, retractS: 0.3 },
  /** Sway/duck is active for activeS, then can't be repeated for cooldownS. */
  dodge: { activeS: 0.45, cooldownS: 0.2 },
  /** |aim| component needed to catch a side dodge (lateral) or a duck / split a guard (up). */
  aim: { hookMin: 0.5, upperMin: 0.5 },
  knockdown: {
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
    /** Reaction time to a thrown punch, s (must be < punch.travelS to ever defend). */
    reactS: 0.08,
    /** On reacting: guard / dodge probability (else nothing). */
    guardP: 0.55,
    dodgeP: 0.2,
    dizzyDodgeP: 0.7,
    /** Chance per decision to punch when free. */
    punchP: 0.15,
  },
};

export type BoxingConfig = typeof boxingConfig;
