import type { Card } from "ts-fsrs";

export interface DayLog {
  new: number;
  review: number;
  again: number;
}

export interface Progress {
  cards: Record<string, Card>;
  /** Words the learner already knows: never scheduled, listed on their own. */
  familiar: Record<string, boolean>;
  starred: Record<string, boolean>;
  notes: Record<string, string>;
  /** Day key -> ids first learned that day, so the daily limit survives reloads. */
  learned: Record<string, string[]>;
  log: Record<string, DayLog>;
  /** Word id -> time of its last local change, which decides the winner when devices merge. */
  changedAt: Record<string, number>;
  /** Holds changes the cloud copy has not received yet. */
  dirty: boolean;
}

export const emptyProgress = (): Progress => ({
  cards: {},
  familiar: {},
  starred: {},
  notes: {},
  learned: {},
  log: {},
  changedAt: {},
  dirty: false,
});

const WORD_FIELDS = ["cards", "familiar", "starred", "notes"] as const;

/** Stamps every word whose entry changed between two progress values. */
export function stampChanges(prev: Progress, next: Progress, now = Date.now()): Progress {
  const changedAt = { ...next.changedAt };
  for (const field of WORD_FIELDS) {
    for (const id of new Set([...Object.keys(prev[field]), ...Object.keys(next[field])])) {
      if (prev[field][id] !== next[field][id]) changedAt[id] = now;
    }
  }
  return { ...next, changedAt, dirty: true };
}

/** Per word the newer side wins, so a deletion on one device beats an older copy on the other. */
export function mergeProgress(local: Progress, saved: Partial<Progress>): Progress {
  const remote = { ...emptyProgress(), ...saved };
  const merged: Progress = { ...local, cards: {}, familiar: {}, starred: {}, notes: {}, changedAt: {} };
  const ids = new Set<string>();
  for (const side of [local, remote]) {
    for (const field of WORD_FIELDS) Object.keys(side[field]).forEach((id) => ids.add(id));
    Object.keys(side.changedAt).forEach((id) => ids.add(id));
  }
  for (const id of ids) {
    const localTime = local.changedAt[id] ?? 0;
    const remoteTime = remote.changedAt[id] ?? 0;
    const winner = remoteTime > localTime ? remote : local;
    const fallback = winner === local ? remote : local;
    // Without any timestamp on the winner, keep whichever side actually holds the word.
    const source = (winner.changedAt[id] ?? 0) === 0 && WORD_FIELDS.every((f) => winner[f][id] === undefined) ? fallback : winner;
    if (source.cards[id]) merged.cards[id] = source.cards[id];
    if (source.familiar[id]) merged.familiar[id] = true;
    if (source.starred[id]) merged.starred[id] = true;
    if (source.notes[id] !== undefined) merged.notes[id] = source.notes[id];
    const time = Math.max(localTime, remoteTime);
    if (time) merged.changedAt[id] = time;
  }
  merged.learned = { ...remote.learned };
  for (const [day, list] of Object.entries(local.learned)) {
    merged.learned[day] = [...new Set([...(merged.learned[day] ?? []), ...list])];
  }
  merged.log = { ...remote.log };
  for (const [day, log] of Object.entries(local.log)) {
    const other = merged.log[day];
    merged.log[day] = other
      ? { new: Math.max(log.new, other.new), review: Math.max(log.review, other.review), again: Math.max(log.again, other.again) }
      : log;
  }
  return merged;
}
