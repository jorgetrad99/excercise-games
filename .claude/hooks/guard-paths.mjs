// PreToolUse(Edit|Write|MultiEdit): block writes to human-owned paths (AGENTS.md §3).
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? '';
const rel = relative(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), target).split(sep).join('/');
const blocked = [/^fixtures\//, /^public\/models\//, /^docs\/PLAN\.md$/, /^\.claude\/settings\.json$/];

if (blocked.some((re) => re.test(rel))) {
  console.error(`Blocked: ${rel} is human-owned (AGENTS.md §3). Say so in docs/PROGRESS.md instead.`);
  process.exit(2);
}
