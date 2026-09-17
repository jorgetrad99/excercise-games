// Runs a hook from `main`'s committed tree, not from whatever branch this checkout has out:
//   node .claude/hooks/run-main.mjs <guard-paths|format-and-typecheck|remind-progress-log>
// Claude Code runs hooks from the main checkout, so their behaviour used to depend on that checkout's
// branch (PROGRESS 2026-09-16). main's .claude/hooks/ and scripts/e2e-lock.mjs are exported once per main
// commit into <git-common-dir>/claude-hooks/<sha>/ and run from there, with the hook input on stdin.
// Failure policy: the guard fails CLOSED (anything but its own allow blocks the edit); advisory hooks fail OPEN.
// To try a hook change before it's on main, run the hook file directly (tests/unit/*.spec.ts do).
// ponytail: one cache dir per main commit, never pruned (a few KB each).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const POLICY = { 'guard-paths': 'closed', 'format-and-typecheck': 'open', 'remind-progress-log': 'open' };
const name = process.argv[2] ?? '';
const policy = POLICY[name];

function fail(reason) {
  if (policy === 'open') {
    console.log(`${name} hook skipped: ${reason}`);
    process.exit(0);
  }
  console.error(`Blocked: hook ${name || '(none)'} could not run from main (${reason}). Fix it, then retry.`);
  process.exit(2);
}

if (!policy) fail(`unknown hook; expected one of ${Object.keys(POLICY).join(', ')}`);

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** main's hooks at its current commit, exported once. Returns the export root. */
function mainTree(cwd) {
  const common = resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd));
  const sha = git(['rev-parse', 'main^{commit}'], cwd);
  const dir = join(common, 'claude-hooks', sha);
  if (existsSync(join(dir, '.complete'))) return dir;
  const tmp = `${dir}.tmp-${process.pid}`;
  // git show per file, not `git archive | tar`: Git Bash's GNU tar reads C:\… as a remote host.
  const files = git(['ls-tree', '-r', '--name-only', sha, '.claude/hooks', 'scripts/e2e-lock.mjs'], cwd);
  for (const f of files.split('\n').filter(Boolean)) {
    const out = join(tmp, f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, execFileSync('git', ['show', `${sha}:${f}`], { cwd }));
  }
  writeFileSync(join(tmp, '.complete'), sha);
  try {
    renameSync(tmp, dir);
  } catch {
    rmSync(tmp, { recursive: true, force: true }); // another hook exported it first
    if (!existsSync(join(dir, '.complete'))) throw new Error(`could not export main's hooks to ${dir}`);
  }
  return dir;
}

let script;
try {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  script = join(mainTree(cwd), '.claude', 'hooks', `${name}.mjs`);
  if (!existsSync(script)) throw new Error(`main has no .claude/hooks/${name}.mjs`);
} catch (e) {
  fail(e instanceof Error ? e.message.split('\n')[0] : String(e));
}

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  // no stdin (Stop hooks may send none)
}
const r = spawnSync(process.execPath, [script], { input, stdio: ['pipe', 'inherit', 'inherit'] });
if (policy === 'open') process.exit(0);
if (r.status === 0 || r.status === 2) process.exit(r.status);
fail(r.error ? r.error.message : `guard exited ${r.status ?? r.signal}`);
