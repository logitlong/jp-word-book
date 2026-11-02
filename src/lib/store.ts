import { clear, createStore, del, get, set, setMany } from "idb-keyval";
import { PERSONAL } from "./edition";

// Both sites share one origin, so the public one must never open the owner's database.
// The store keeps the site's first name: renaming it would lose every visitor's saved progress.
const db = PERSONAL ? undefined : createStore("n1-word-book", "keyval");
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import type { Note, ParsedDeck } from "./apkg";
import { emptyProgress, type Progress } from "./sync";

export { emptyProgress, Rating };
export type { Grade, Progress };

export type StudyMode = "read" | "listen" | "recall";

const ALL_LEVELS = ["N1", "N5", "N1 真题"] as const;
export type Level = (typeof ALL_LEVELS)[number];
/** The exam word list is a teacher's handout, so it stays in the private repository and off the public site. */
export const LEVELS = ALL_LEVELS.filter((level) => PERSONAL || level !== "N1 真题");
export const LEVEL_TITLE: Record<Level, string> = { N1: "无敌绿宝书 N1", N5: "无敌绿宝书 N5", "N1 真题": "N1 真题" };

export interface Settings {
  level: Level;
  dailyNew: number;
  retention: number;
  autoplay: boolean;
  voice: 1 | 2;
  mode: StudyMode;
  newOrder: "book" | "random";
  groupBy: "deck" | "size";
  groupSize: number;
  theme: "system" | "light" | "dark";
  /** Quiz text size on this device, as a multiple of the default. */
  quizScale: number;
}

export const GROUP_SIZE_MIN = 10;
export const GROUP_SIZE_MAX = 200;
export const LEECH_LAPSES = 2;

export const defaultSettings: Settings = {
  level: "N1",
  dailyNew: 20,
  retention: 0.9,
  autoplay: true,
  voice: 1,
  mode: "read",
  newOrder: "book",
  groupBy: "deck",
  groupSize: 50,
  theme: "system",
  quizScale: 1,
};

/** Bump when parsing changes: older imports are asked to re-import, and progress keeps working by note id. */
export const DECK_VERSION = 4;

/** N1 keeps the keys it had before levels existed, so devices don't load it again. */
const deckKey = (key: string, level: Level) => (level === "N1" ? key : `${key}:${level}`);

export const loadDeck = async (level: Level) => ({
  notes: (await get<number>(deckKey("deck-version", level), db)) === DECK_VERSION ? await get<Note[]>(deckKey("deck-notes", level), db) : undefined,
});

export async function saveDeck(deck: ParsedDeck, level: Level) {
  // Phones may evict site data under storage pressure; this asks the browser to keep it.
  await navigator.storage?.persist?.().catch(() => false);
  await setMany([
    [deckKey("deck-version", level), DECK_VERSION],
    [deckKey("deck-name", level), deck.name],
    [deckKey("deck-notes", level), deck.notes],
    ...[...deck.audio].map(
      ([name, bytes]) => [`audio:${name}`, new Blob([bytes as BlobPart], { type: "audio/mpeg" })] as [string, Blob],
    ),
  ], db);
}

/** Older progress and backups kept manually marked words under `mastered`. */
export function normalizeProgress(saved?: Partial<Progress> & { mastered?: Record<string, boolean> }): Progress {
  const { mastered, ...rest } = saved ?? {};
  return { ...emptyProgress(), ...rest, familiar: { ...mastered, ...rest.familiar } };
}

export const loadAudio = (name: string) => get<Blob>(`audio:${name}`, db);
export const saveAudio = (name: string, blob: Blob) => set(`audio:${name}`, blob, db);
export const loadProgress = async () => normalizeProgress(await get("progress", db));
export const saveProgress = (p: Progress) => set("progress", p, db);
export const loadSettings = async () => ({ ...defaultSettings, ...(await get<Settings>("settings", db)) });
export const saveSettings = (s: Settings) => set("settings", s, db);
export const clearAll = () => clear(db);

export const loadEntries = <T,>(key: string) => get<T>(`entries:${key}`, db);
export const saveEntries = <T,>(key: string, value: T) => set(`entries:${key}`, value, db);

export const loadToken = () => get<string>("cloud-token", db);
export const saveToken = (token: string) => set("cloud-token", token, db);
export const clearToken = () => del("cloud-token", db);
export const loadSyncSha = () => get<string>("cloud-sha", db);
export const saveSyncSha = (sha: string) => set("cloud-sha", sha, db);

export const dayKey = (now = new Date()) =>
  `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

const scheduler = (retention: number) =>
  fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true });

export const reviveCard = (c: Card): Card => ({
  ...c,
  due: new Date(c.due),
  last_review: c.last_review ? new Date(c.last_review) : undefined,
});

export function grade(card: Card | undefined, rating: Grade, retention: number, now = new Date()) {
  const current = card ? reviveCard(card) : createEmptyCard(now);
  return scheduler(retention).next(current, now, rating).card;
}

export function previewIntervals(card: Card | undefined, retention: number, now = new Date()) {
  const current = card ? reviveCard(card) : createEmptyCard(now);
  const preview = scheduler(retention).repeat(current, now);
  return {
    [Rating.Again]: preview[Rating.Again].card.due.getTime() - now.getTime(),
    [Rating.Hard]: preview[Rating.Hard].card.due.getTime() - now.getTime(),
    [Rating.Good]: preview[Rating.Good].card.due.getTime() - now.getTime(),
    [Rating.Easy]: preview[Rating.Easy].card.due.getTime() - now.getTime(),
  } as Record<Grade, number>;
}

export function formatInterval(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1分";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}天`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}个月` : `${(days / 365).toFixed(1)}年`;
}

export type Status = "new" | "learning" | "mastered" | "familiar";

export const STATUS_LABEL: Record<Status, string> = {
  new: "未学",
  learning: "学习中",
  mastered: "已掌握",
  familiar: "已熟悉",
};

/** Mastered comes from FSRS (stability of at least 21 days); familiar is the learner's own call. */
export function statusOf(id: string, p: Progress): Status {
  if (p.familiar[id]) return "familiar";
  const card = p.cards[id];
  if (!card) return "new";
  return card.state === 2 && card.stability >= 21 ? "mastered" : "learning";
}

export const isDue = (id: string, p: Progress, now = new Date()) => {
  const card = p.cards[id];
  return !!card && !p.familiar[id] && new Date(card.due) <= now;
};

export const isUnseen = (id: string, p: Progress) => !p.cards[id] && !p.familiar[id];

export function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const orderNew = (notes: Note[], s: Settings) => (s.newOrder === "random" ? shuffled(notes) : notes);

/** New words learned that day from this list, so each level has its own daily quota. */
export function learnedOn(notes: Note[], p: Progress, now = new Date()) {
  const learned = new Set(p.learned[dayKey(now)]);
  return notes.filter((n) => learned.has(n.id)).length;
}

export function buildQueue(notes: Note[], p: Progress, s: Settings, now = new Date()) {
  const due = notes.filter((n) => isDue(n.id, p, now));
  const left = Math.max(0, s.dailyNew - learnedOn(notes, p, now));
  const unseen = notes.filter((n) => isUnseen(n.id, p));
  return { due, fresh: orderNew(unseen, s).slice(0, left), unseen };
}

export interface Group {
  key: string;
  title: string;
  notes: Note[];
}

const unitTitle = (unit: string) => {
  const part = unit.match(/-(\w+)$/)?.[1];
  if (!part) return unit;
  return /^\d+$/.test(part) ? `第 ${part} 单元` : `${part} 单元`;
};

/** Words split by the deck's own units, or into equal runs of the chosen size in book order. */
export function buildGroups(notes: Note[], s: Settings): Group[] {
  if (s.groupBy === "size") {
    const size = Math.min(GROUP_SIZE_MAX, Math.max(GROUP_SIZE_MIN, s.groupSize || GROUP_SIZE_MIN));
    const groups: Group[] = [];
    for (let i = 0; i < notes.length; i += size) {
      groups.push({ key: `size-${size}-${i}`, title: `第 ${groups.length + 1} 组`, notes: notes.slice(i, i + size) });
    }
    return groups;
  }
  const units = new Map<string, Note[]>();
  for (const note of notes) {
    const unit = note.unit || "未分组";
    if (!units.has(unit)) units.set(unit, []);
    units.get(unit)!.push(note);
  }
  return [...units].map(([unit, list]) => ({ key: unit, title: unitTitle(unit), notes: list }));
}

const dayFrom = (now: Date, offset: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);

/** Consecutive study days ending today, or yesterday when today has no reviews yet. */
export function streak(p: Progress, now = new Date()) {
  const studied = (d: Date) => !!p.log[dayKey(d)];
  let offset = studied(now) ? 0 : -1;
  let days = 0;
  while (studied(dayFrom(now, offset))) {
    days += 1;
    offset -= 1;
  }
  return days;
}

export const recentDays = (p: Progress, count: number, now = new Date()) =>
  Array.from({ length: count }, (_, i) => {
    const date = dayFrom(now, i - count + 1);
    const log = p.log[dayKey(date)] ?? { new: 0, review: 0, again: 0 };
    return { date, ...log };
  });

/** Words falling due on each of the next days; anything already overdue counts as today. */
export function forecast(notes: Note[], p: Progress, count: number, now = new Date()) {
  const days = Array.from({ length: count }, (_, i) => ({ date: dayFrom(now, i), due: 0 }));
  const start = dayFrom(now, 0).getTime();
  for (const note of notes) {
    const card = p.cards[note.id];
    if (!card || p.familiar[note.id]) continue;
    const offset = Math.floor((new Date(card.due).getTime() - start) / 86400000);
    if (offset < count) days[Math.max(0, offset)].due += 1;
  }
  return days;
}
