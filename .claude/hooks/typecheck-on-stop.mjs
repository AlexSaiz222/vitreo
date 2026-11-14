// Claude Code Stop hook: runs `pnpm typecheck` before Claude finishes a turn
// when TypeScript files have changed. Exit 2 blocks the stop and feeds the
// errors back to Claude. A passing fingerprint is cached in .git so unchanged
// work is not checked twice.
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
// Already retried once after a failure: let Claude stop and report it.
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: 'utf8' });

const changed = git('status --porcelain --untracked-files=all')
  .split('\n')
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
  .map((path) => path.split(' -> ').pop())
  .filter((path) => /\.(ts|tsx|mts|cts)$/.test(path) || /(^|\/)tsconfig[^/]*\.json$/.test(path));

if (changed.length === 0) process.exit(0);

const hash = createHash('sha256');
for (const path of changed.sort()) {
  const abs = join(root, path);
  hash.update(path);
  if (existsSync(abs)) {
    const { mtimeMs, size } = statSync(abs);
    hash.update(`${mtimeMs}:${size}`);
  }
}
const fingerprint = hash.digest('hex');
const cacheFile = join(root, git('rev-parse --git-dir').trim(), 'claude-typecheck-ok');
if (existsSync(cacheFile) && readFileSync(cacheFile, 'utf8') === fingerprint) process.exit(0);

const result = spawnSync('pnpm', ['typecheck'], { cwd: root, encoding: 'utf8', shell: true });
if (result.status === 0) {
  writeFileSync(cacheFile, fingerprint);
  process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  .trim()
  .split('\n')
  .slice(-60)
  .join('\n');
process.stderr.write(`pnpm typecheck failed. Fix these errors before finishing:\n\n${output}\n`);
process.exit(2);
