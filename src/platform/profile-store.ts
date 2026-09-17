// ProfileStore (PLAN §1.5/§2.4, M5.1): named local players and their match history, in localStorage
// behind a versioned schema with migrations. No accounts: a player is a name typed or picked on the
// "Who's playing?" screen. Data the store can't understand (newer version, corrupt JSON) is never
// overwritten: corrupt data is copied to a backup key first, newer data makes the store read-only.

export const STORAGE_KEY = 'move-arcade.profile';
export const PROFILE_VERSION = 1;
/** Matches kept per player (oldest dropped first); ~200 B each keeps a full profile well under 1 MB. */
export const MAX_MATCHES = 1000; // ponytail: flat cap; aggregate old matches if players ever hit it

export type MatchResult = 'win' | 'loss' | 'draw';

/** What a game reports for one player when a match ends (MiniGame.matchStats). */
export interface MatchStats {
  /** null for games without winners (Skate Run). */
  result: MatchResult | null;
  /** camelCase key → number; charts label them by splitting the key ("cleanHits" → "clean hits"). */
  stats: Record<string, number>;
}

export interface MatchRecord extends MatchStats {
  game: string;
  /** ISO time the match ended. */
  at: string;
  /** Players in the session (1, or 2 for local versus). */
  players: number;
  /** The other player's name, "CPU" for a bot opponent, null when there is none. */
  opponent: string | null;
}

export interface ProfileV1 {
  version: 1;
  /** Keyed by display name, exactly as entered (trimmed). */
  players: Record<string, { matches: MatchRecord[] }>;
  /** Names in the slots of the last launched session, for preselecting the "Who's playing?" screen. */
  lastNames: string[];
}

export type Profile = ProfileV1;

export const emptyProfile = (): Profile => ({ version: 1, players: {}, lastNames: [] });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Upgrades `raw` to the current schema. null = a newer (unknown) version or not a profile at all. */
export function migrate(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  // Version 0 = before this store: only a bare "players" map of match arrays may exist.
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > PROFILE_VERSION) return null;
  if (version === 0) {
    const players = isRecord(raw.players) ? raw.players : {};
    return {
      version: 1,
      players: Object.fromEntries(
        Object.entries(players).map(([name, m]) => [name, { matches: Array.isArray(m) ? m : [] }]),
      ) as ProfileV1['players'],
      lastNames: [],
    };
  }
  if (!isRecord(raw.players)) return null;
  return { ...emptyProfile(), ...(raw as Partial<ProfileV1>), version: 1 } as Profile;
}

/** Trim and collapse whitespace; empty and over-long names are rejected (null). */
export function cleanName(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length > 0 && n.length <= 24 ? n : null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked: the store works in memory for this page
  }
}

/** Reads the saved profile. readOnly: data this build must not overwrite (newer, or unbackupable). */
function load(storage: StorageLike | null): { profile: Profile; readOnly: boolean } {
  let text: string | null;
  try {
    text = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { profile: emptyProfile(), readOnly: true };
  }
  if (text === null) return { profile: emptyProfile(), readOnly: false };
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    // corrupt: backed up below
  }
  const migrated = parsed === undefined ? null : migrate(parsed);
  if (migrated) return { profile: migrated, readOnly: false };
  if (isRecord(parsed) && Number(parsed.version) > PROFILE_VERSION) {
    console.warn('profile: saved by a newer version; history is not recorded in this build');
    return { profile: emptyProfile(), readOnly: true };
  }
  try {
    storage?.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, text);
  } catch {
    return { profile: emptyProfile(), readOnly: true }; // couldn't back it up: don't overwrite it
  }
  console.warn('profile: unreadable saved data was backed up and a new profile started');
  return { profile: emptyProfile(), readOnly: false };
}

export function createProfileStore(storage: StorageLike | null = defaultStorage()) {
  const { profile, readOnly } = load(storage);

  const save = (): void => {
    if (readOnly || !storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (err) {
      console.warn('profile: could not save', err); // quota or blocked: keep the in-memory copy
    }
  };

  return {
    readOnly: () => readOnly,
    /** Known names, most recently played first. */
    names(): string[] {
      const last = (n: string) => profile.players[n]?.matches.at(-1)?.at ?? '';
      return Object.keys(profile.players).sort((a, b) => last(b).localeCompare(last(a)));
    },
    lastNames: (): readonly string[] => profile.lastNames,
    /** Remember the session's names (also creates players that have no matches yet). */
    setLastNames(names: readonly string[]): void {
      profile.lastNames = [...names];
      for (const n of names) profile.players[n] ??= { matches: [] };
      save();
    },
    addMatch(name: string, match: MatchRecord): void {
      const p = (profile.players[name] ??= { matches: [] });
      p.matches.push(match);
      if (p.matches.length > MAX_MATCHES) p.matches.splice(0, p.matches.length - MAX_MATCHES);
      save();
    },
    /** A player's matches, oldest first, optionally of one game. */
    matches(name: string, game?: string): readonly MatchRecord[] {
      const all = profile.players[name]?.matches ?? [];
      return game ? all.filter((m) => m.game === game) : all;
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
