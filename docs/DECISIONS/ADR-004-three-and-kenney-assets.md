# ADR-004: `three` as a runtime dependency; Kenney CC0 models vendored in the repo

- **Status:** Accepted for `three`. The Kenney asset half is superseded by ADR-005 (Quaternius).
- **Date:** 2026-09-16

## Context

M4 needs a renderer. PLAN §1.2 picks three.js behind `createRenderer()`, and ADR-001 picks `WebGLRenderer`. AGENTS §3 requires an ADR for a runtime dependency and exact pins. PLAN §8 Q4 (Kenney flat vs KayKit/Quaternius stylized) is still open, and Jorge said to default to Kenney's flat style.

## Decision

- **Dependencies:** `three` pinned at `0.186.0` (latest at kickoff, r186). `@types/three` is pinned to the same version as a dev dependency. Addons (`GLTFLoader`, `RoomEnvironment`) come from `three/addons/*`, so no extra package.
- **Models:** 10 Kenney CC0 models, copied unmodified into `public/assets/kenney/{city,car,nature}/`, with each kit's `License.txt` and the shared `Textures/colormap.png` the GLBs reference.
  - Sources: City Kit (Roads), Car Kit 3.1, Nature Kit.
  - Total ≈ 370 KB. They're **committed**, unlike the models under `public/models/`, because they're small and part of the look.
- **Asset credits:** `CREDITS.md` lists every file under `public/assets/`, and `tests/unit/credits.spec.ts` fails if one is missing (PLAN §6).
- **Drawing:** models are fitted into the sim's collision boxes and drawn as `InstancedMesh` pools (`src/render/models.ts`). One draw call per sub-mesh per model, whatever the instance count.
- **Environment lighting:** `RoomEnvironment` + PMREM stands in for a Poly Haven HDRI, so no binary is needed until art direction is locked.
- **No `gltf-transform` build step yet.** The kits are already small. Add it when assets grow.

## Consequences

- **Switching art family** (KayKit/Quaternius) means replacing `MODEL_FILES`, the fits in `world-view.ts`, `BIOME_LOOKS`, and the files plus credits.
- **Switching renderer** to `WebGPURenderer` is a `renderer.ts` change. Materials are standard, not node materials.
- **A three.js bump** means changing both pins, re-running the screenshot tests, and reviewing the r-to-r migration guide.
