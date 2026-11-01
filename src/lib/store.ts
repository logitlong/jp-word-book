import { clear, get, set, setMany } from "idb-keyval";
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import type { Note, ParsedDeck } from "./apkg";

export { Rating };
export type { Grade };

export interface Settings {
  dailyNew: number;
  retention: number;
  autoplay: boolean;
  voice: 1 | 2;
}

export interface Progress {
  cards: Record<string, Card>;
  mastered: Record<string, boolean>;
  notes: Record<string, string>;
  /** Day key -> ids first learned that day, so the daily limit survives reloads. */
  learned: Record<string, string[]>;
}

export const defaultSettings: Settings = { dailyNew: 20, retention: 0.9, autoplay: true, voice: 1 };
export const emptyProgress = (): Progress => ({ cards: {}, mastered: {}, notes: {}, learned: {} });

/** Bump when parsing changes: older imports are asked to re-import, and progress keeps working by note id. */
const DECK_VERSION = 2;

export const loadDeck = async () => ({
  name: await get<string>("deck-name"),
  notes: (await get<number>("deck-version")) === DECK_VERSION ? await get<Note[]>("deck-notes") : undefined,
});

export async function saveDeck(deck: ParsedDeck) {
  // Phones may evict site data under storage pressure; this asks the browser to keep it.
  await navigator.storage?.persist?.().catch(() => false);
  await setMany([
    ["deck-version", DECK_VERSION],
    ["deck-name", deck.name],
    ["deck-notes", deck.notes],
    ...[...deck.audio].map(
      ([name, bytes]) => [`audio:${name}`, new Blob([bytes as BlobPart], { type: "audio/mpeg" })] as [string, Blob],
    ),
  ]);
}

export const loadAudio = (name: string) => get<Blob>(`audio:${name}`);
export const loadProgress = async () => ({ ...emptyProgress(), ...(await get<Progress>("progress")) });
export const saveProgress = (p: Progress) => set("progress", p);
export const loadSettings = async () => ({ ...defaultSettings, ...(await get<Settings>("settings")) });
export const saveSettings = (s: Settings) => set("settings", s);
export const clearAll = () => clear();

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

export type Status = "new" | "learning" | "mastered";

/** Mastered = manually marked, or FSRS stability of at least 21 days in review state. */
export function statusOf(id: string, p: Progress): Status {
  if (p.mastered[id]) return "mastered";
  const card = p.cards[id];
  if (!card) return "new";
  return card.state === 2 && card.stability >= 21 ? "mastered" : "learning";
}

export function buildQueue(notes: Note[], p: Progress, s: Settings, now = new Date()) {
  const due = notes.filter((n) => {
    const card = p.cards[n.id];
    return card && !p.mastered[n.id] && new Date(card.due) <= now;
  });
  const left = Math.max(0, s.dailyNew - (p.learned[dayKey(now)]?.length ?? 0));
  const fresh = notes.filter((n) => !p.cards[n.id] && !p.mastered[n.id]).slice(0, left);
  return { due, fresh };
}
