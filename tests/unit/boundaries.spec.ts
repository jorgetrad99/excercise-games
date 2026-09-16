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
  });
});
