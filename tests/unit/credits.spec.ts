// PLAN §6: every shipped asset must appear in CREDITS.md.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name).replaceAll('\\', '/')],
  );

it('lists every file under public/assets in CREDITS.md', () => {
  const credits = readFileSync('CREDITS.md', 'utf8');
  const files = walk('public/assets');
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((f) => !credits.includes(`\`${f}\``))).toEqual([]);
});
