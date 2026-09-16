# ADR-001: Use three.js `WebGLRenderer` behind a `createRenderer()` factory

- **Status:** Accepted
- **Date:** 2026-09-16

## Context

WebGPU is baseline in all major browsers, and three.js `WebGPURenderer` falls back to WebGL2 automatically. Most of the rendering code will be written by an AI agent. Agent knowledge of three.js leans on the WebGL path, which has ten years of examples. The WebGPU path brings TSL and node materials, where stale or invented APIs are likely. A lane runner with standard materials, instancing and fog gains little from WebGPU. The perf target (60 fps at 1080p on an RTX 4060, fewer than 150 draw calls) is reachable with WebGL2.

## Decision

- Use `WebGLRenderer` for v1.
- Build it only in `src/render/createRenderer.ts`. No other module may construct a renderer or depend on renderer-specific APIs.
- Pin `three` exactly (no `^`). `three` isn't installed yet: it gets added at M4, pinned to the latest stable version at that time (`0.186.0` at M0).
- Check three.js API usage against current docs (Context7), not memory.

## Consequences

- Fewer API surprises, and more of the agent's code is right on the first try.
- No compute shaders or WebGPU-only features. Nothing in v1 needs them.
- Moving to `WebGPURenderer` should take a one-file change in the factory plus a material audit, as long as the factory rule is respected.
