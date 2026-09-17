import { expect, it } from 'vitest';
import { isSoftwareRenderer } from './gpu';

it('flags CPU rasterizers, not real GPUs', () => {
  // The first string is what Chromium reports with --use-angle=d3d11-warp (measured).
  for (const sw of [
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
  ])
    expect(isSoftwareRenderer(sw), sw).toBe(true);
  for (const hw of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M2',
  ])
    expect(isSoftwareRenderer(hw), hw).toBe(false);
});
