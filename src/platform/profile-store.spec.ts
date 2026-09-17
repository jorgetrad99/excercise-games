import { describe, expect, it } from 'vitest';
import {
  cleanName,
  createProfileStore,
  MAX_MATCHES,
  migrate,
  STORAGE_KEY,
  type MatchRecord,
} from './profile-store';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const match = (at: string, over: Partial<MatchRecord> = {}): MatchRecord => ({
  game: 'boxing',
  at,
  players: 2,
  opponent: 'Beto',
  result: 'win',
  stats: { cleanHits: 12 },
  ...over,
});

describe('ProfileStore', () => {
  it('persists matches per name across reloads and lists names most recent first', () => {
    const storage = memory();
    const a = createProfileStore(storage);
    a.setLastNames(['Ana', 'Beto']);
    a.addMatch('Ana', match('2026-09-16T10:00:00Z'));
    a.addMatch('Beto', match('2026-09-16T11:00:00Z', { opponent: 'Ana', result: 'loss' }));
    const b = createProfileStore(storage);
    expect(b.names()).toEqual(['Beto', 'Ana']);
    expect(b.lastNames()).toEqual(['Ana', 'Beto']);
    expect(b.matches('Ana', 'boxing')).toHaveLength(1);
    expect(b.matches('Ana', 'skate-run')).toHaveLength(0);
    expect(b.matches('Beto')[0]!.result).toBe('loss');
  });

  it('caps history per player, dropping the oldest', () => {
    const s = createProfileStore(memory());
    for (let i = 0; i < MAX_MATCHES + 5; i++) s.addMatch('Ana', match(`t${i}`));
    expect(s.matches('Ana')).toHaveLength(MAX_MATCHES);
    expect(s.matches('Ana')[0]!.at).toBe('t5');
  });

  it('migrates an unversioned profile to v1', () => {
    expect(migrate({ players: { Ana: [match('x')] } })).toEqual({
      version: 1,
      players: { Ana: { matches: [match('x')] } },
      lastNames: [],
    });
    expect(migrate({ version: 1, players: {} })).toEqual({
      version: 1,
      players: {},
      lastNames: [],
    });
    expect(migrate({ version: 2, players: {} })).toBeNull();
    expect(migrate('nope')).toBeNull();
  });

  it('never overwrites data from a newer version', () => {
    const newer = JSON.stringify({ version: 99, players: { Ana: 'future' } });
    const storage = memory({ [STORAGE_KEY]: newer });
    const s = createProfileStore(storage);
    expect(s.readOnly()).toBe(true);
    s.addMatch('Ana', match('now'));
    expect(storage.data.get(STORAGE_KEY)).toBe(newer);
  });

  it('backs up corrupt data before starting a fresh profile', () => {
    const storage = memory({ [STORAGE_KEY]: '{not json' });
    const s = createProfileStore(storage);
    s.addMatch('Ana', match('now'));
    const backup = [...storage.data.keys()].find((k) => k.startsWith(`${STORAGE_KEY}.corrupt-`));
    expect(backup && storage.data.get(backup)).toBe('{not json');
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!).players.Ana.matches).toHaveLength(1);
  });

  it('works without storage', () => {
    const s = createProfileStore(null);
    s.addMatch('Ana', match('now'));
    expect(s.matches('Ana')).toHaveLength(1);
  });

  it('cleans names', () => {
    expect(cleanName('  Ana   María ')).toBe('Ana María');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(25))).toBeNull();
  });
});
