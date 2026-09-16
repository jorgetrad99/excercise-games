// PostToolUse(Edit|Write|MultiEdit): prettier the edited .ts file, then typecheck. Informs, never blocks.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
if (!file.endsWith('.ts')) process.exit(0);

const run = (args) => {
  try {
    execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
};

run(['node_modules/prettier/bin/prettier.cjs', '--write', file]);
const errors = run(['node_modules/typescript/bin/tsc', '--noEmit', '-p', '.', '--incremental']);
if (errors) console.log(`tsc errors:\n${errors.split('\n').slice(0, 30).join('\n')}`);
