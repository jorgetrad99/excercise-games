# ADR-005: Quaternius CC0 models replace the Kenney flat set

- **Status:** Accepted (Jorge approved the before/after screenshot comparison, 2026-09-16). Supersedes the asset half of ADR-004; `three` stays as decided there.
- **Date:** 2026-09-16

## Context

Jorge asked to replace the Kenney flat set with Quaternius or KayKit models (CC0 only), agent's call.

- **KayKit** has official GitHub repos: City Builder Bits, and Character Pack: Adventurers.
  - Its characters are fantasy adventurers (knight, mage, rogue): a poor fit for a skater.
  - The city pack has no park vegetation.
- **Quaternius** covers both biomes, and the character packs are in the same family:
  - **Ultimate Modular Men:** casual characters, rigged and animated.
  - **Ultimate Stylized Nature:** trees, bushes, flowers.
  - **Buildings, Cars, Public Transport, Modular Streets:** all CC0, downloadable from Quaternius' public Google Drive folders linked on quaternius.com.
- The newest city pack (Downtown City MegaKit) is itch.io-only. Its download flow can't be scripted: two attempts returned "invalid key", so I stopped.

## Decision

- **Source:** Quaternius only, so the look stays one family (PLAN §8 Q4).
- **Vendoring:** `scripts/vendor-quaternius.mjs` downloads by Drive file id and converts to `public/assets/quaternius/**`.
  - Converters run through `npx` at vendoring time only: `obj2gltf@3.2.0` for OBJ+MTL → GLB, and `@gltf-transform/cli@4.5.0` for prune and 512 px texture resize. They are **not** project dependencies.
  - The character keeps 5 of 24 clips.
  - Total ≈ 7.6 MB, committed. CREDITS lists every file, checked by a test.
- **Pieces the family doesn't have** are procedural, in matching flat colours: street hurdle and height bar, park log and beam, a short-wall construction box, and the skateboard.
- **Rendering:** each OBJ-converted model's flat-colour parts are merged at load time into one vertex-coloured mesh (`render/merge.ts`). Props and backdrop don't cast shadows.
  - The first cut was 241–267 draw calls; now it's 57–59, against the 150 budget.
- **Skater:** `Casual_Hoodie` on the procedural board.
  - Clip plus clip time are pure functions of sim state, so screenshots stay deterministic.
  - Crouch/tuck are added as bone rotations about the character's side axis.
  - No Quaternius clip has jump or crouch; Wave is the grab arm.

## Consequences

- **Perf:** 60 fps at 1080p on the street, in the park (862k triangles), and with the pose worker running. Draw calls 57–59.
- **More art:** add ids to `MODEL_FILES` and the vendor script, plus a fit in `world-view.ts` and a CREDITS row.
- **The art is heavier than Kenney** (7.6 MB vs 0.4 MB, 0.6–0.9 M triangles vs 35–86 k). Mid-range laptops need a check. The first levers are fewer backdrop trees or simplified buildings (`gltf-transform simplify`).
