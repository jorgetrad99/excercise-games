// PostToolUse(Edit|Write|MultiEdit): prettier the edited .ts file, then typecheck. Informs, never blocks.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lockPath, waitForLock } from '../../scripts/e2e-lock.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
if (!file.endsWith('.ts')) process.exit(0);

const sh = (cmd, args, cwd) => {
  try {
    return { out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' }), err: '' };
  } catch (e) {
    return { out: null, err: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
// Run in the checkout that contains the file (a worktree under tmp/ has its own node_modules and tsconfig).
const root = sh('git', ['rev-parse', '--show-toplevel'], dirname(file)).out?.trim() || process.cwd();
if (!existsSync(join(root, 'node_modules/typescript'))) {
  console.log(`prettier/tsc skipped: no node_modules in ${root} (run pnpm install there).`);
  process.exit(0);
}

sh(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--write', file], root);
// tsc is heavy: never run it while perf gates measure (scripts/e2e-lock.mjs). Stay under the 60 s hook timeout.
try {
  await waitForLock({ label: 'typecheck hook', timeoutMs: 45_000, path: lockPath(root) });
} catch (e) {
  console.log(`tsc skipped: ${e.message}\nRun pnpm typecheck once the perf run ends.`);
  process.exit(0);
}
const tsc = ['node_modules/typescript/bin/tsc', '--noEmit', '-p', '.', '--incremental'];
const { err } = sh(process.execPath, tsc, root);
if (err) console.log(`tsc errors:\n${err.split('\n').slice(0, 30).join('\n')}`);
