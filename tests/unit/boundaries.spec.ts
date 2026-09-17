import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const ruleIds = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0]!.messages.map((m) => m.ruleId);

describe('PLAN §3 boundaries are enforced by lint', () => {
  it('core rejects three, DOM globals, other layers and Math.random', async () => {
    const ids = await ruleIds(
      "import 'three';\nimport { x } from '../render/x';\nexport const r = Math.random() + window.innerWidth + x;\n",
      'src/core/bad.ts',
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        'no-restricted-imports',
        'no-restricted-globals',
        'no-restricted-properties',
      ]),
    );
    expect(ids.filter((id) => id === 'no-restricted-imports')).toHaveLength(2);
  });

  it('core may import its own input contract (core/input.ts) but not the input/ layer', async () => {
    expect(await ruleIds("export * from './input';\n", 'src/core/ok.ts')).toEqual([]);
    expect(await ruleIds("export * from '../input/keyboard';\n", 'src/core/bad.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('render rejects pose; pose rejects core; games reject sibling games', async () => {
    expect(await ruleIds("export * from '../pose/x';\n", 'src/render/bad.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds("export * from '../core/prng';\n", 'src/pose/bad.ts')).toContain(
      'no-restricted-imports',
    );
    expect(
      await ruleIds("export * from '../penalty/sim';\n", 'src/games/skate-run/bad.ts'),
    ).toContain('no-restricted-imports');
    expect(
      await ruleIds(
        "export * from '../../core/prng';\nexport * from './view';\n",
        'src/games/skate-run/ok.ts',
      ),
    ).toEqual([]);
    expect(await ruleIds("export * from '../types';\n", 'src/games/skate-run/ok.ts')).toEqual([]);
  });

  it('games reject a sibling game through its folder index too; the contract imports no game', async () => {
    for (const spec of ['../boxing', '../boxing/index', '../boxing/gestures'])
      expect(
        await ruleIds(`export * from '${spec}';\n`, 'src/games/skate-run/bad.ts'),
        spec,
      ).toContain('no-restricted-imports');
    expect(await ruleIds("export * from './boxing';\n", 'src/games/types.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds("export * from '../core/input';\n", 'src/games/types.ts')).toEqual([]);
    expect(await ruleIds("export * from './boxing';\n", 'src/games/registry.ts')).toEqual([]);
  });

  it('core game modules one folder down may import the core input contract', async () => {
    expect(await ruleIds("export * from '../input';\n", 'src/core/boxing/ok.ts')).toEqual([]);
    // …but from core/ itself '../input' is the input/ layer.
    expect(await ruleIds("export * from '../input';\n", 'src/core/bad.ts')).toContain(
      'no-restricted-imports',
    );
  });
});
