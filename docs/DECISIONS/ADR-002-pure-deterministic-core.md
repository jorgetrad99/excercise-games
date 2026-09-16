# ADR-002: The game simulation is a pure, deterministic TypeScript core

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

The game is controlled by body pose from a webcam and rendered in 3D. The agent building it can't stand in front of a camera or see the scene. Multiplayer is also needed. Networking a physics sim is expensive, but replaying the same deterministic sim from a shared seed is cheap.

## Decision

- `src/core/` contains only pure TypeScript: no DOM, no three.js, no MediaPipe, no timers, no `performance`/`Date` clocks, no `Math.random`.
- Time only enters through `step(dt, events)`. Randomness only comes from the seeded PRNG (`core/prng.ts`, mulberry32), e.g. `mulberry32(seed + chunkIndex)`.
- Contract: `(seed, InputEvent[]) → identical run`. A determinism test hashes state after 60 s (M3).
- Inputs are abstracted as `InputSource` (pose, keyboard, replay fixture, network). The sim never knows which one is active.
- Enforced by ESLint in `eslint.config.js` (`no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties`), with the rules themselves covered by `tests/unit/boundaries.spec.ts`.

## Consequences

- Gameplay can be tested headlessly: fixture-driven gesture tests, a bot that plays 2 minutes, and solvability checks. No camera or GPU needed.
- Remote multiplayer becomes "shared seed + ghost state relay" instead of netcode (PLAN §1.4).
- Some duplication at the edges: `render` interpolates snapshots instead of reaching into sim internals.
- Floating-point results must stay identical across runs on the same machine. Clients on different machines may drift a little, which is fine because ghosts render from relayed state, not a re-simulation.
