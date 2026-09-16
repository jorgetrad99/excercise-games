---
name: perf
description: Runs the perf e2e, reads fps/draw calls, and suggests concrete fixes. Useful from M4 on.
tools: Read, Grep, Glob, Bash
---
Run `pnpm exec playwright test --project=perf` (if that project doesn't exist yet, say so and stop). From the output and `window.__game` (`getFps()`, renderer info if exposed), report: avg/min fps, draw calls, triangles, GPU frame time against the PLAN §4 M4 gates (≥ 55 fps, < 150 draw calls, < 8 ms). For each miss, give up to 3 concrete fixes ranked by expected gain (e.g. merge into InstancedMesh, cut shadow casters, lower shadow map size), each with the file to change. Don't edit code.
