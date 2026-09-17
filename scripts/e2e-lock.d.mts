export interface LockHolder {
  pid: number;
  cwd: string;
  branch: string;
  startedAt: string;
}
export function lockPath(cwd?: string): string;
export function currentHolder(path?: string): LockHolder | null;
export function describeHolder(h: LockHolder, path: string): string;
export function acquire(path?: string): () => void;
export function waitForLock(opts?: {
  label?: string;
  timeoutMs?: number;
  pollMs?: number;
  path?: string;
}): Promise<number>;
