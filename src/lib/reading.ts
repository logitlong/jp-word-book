import { readPrivateText } from "./cloud";
import { loadEntries, saveEntries } from "./store";

/** Bump when the reading file changes, so devices fetch it again. */
const READING_VERSION = 1;
const READING_FILE = "deck/reading/n1.json";

export type PassageType = "short" | "mid" | "long" | "ab" | "claim" | "info";
export type Trap = "said" | "missing" | "circular" | "reversed" | "offtopic";

export interface ReadingOption {
  text: string;
  /** Empty on the right answer. */
  trap: Trap | null;
  why: string;
}

export interface ReadingQuestion {
  stem: string;
  options: ReadingOption[];
  /** 1-based. */
  ans: number;
  /** Exact passages of the text that answer the question, highlighted after answering. */
  evidence: string[];
  note: string;
}

export interface Passage {
  id: string;
  type: PassageType;
  title: string;
  /** `【①…】` marks the underlined parts questions refer to; AB passages hold one text per side. */
  text: string | Record<string, string>;
  source: string;
  notes: { term: string; def: string }[];
  questions: ReadingQuestion[];
  gist: string;
}

export interface ReadingLesson {
  types: { id: PassageType; no: number; name: string; zh: string; len: string; count: string; minutes: number; tip: string }[];
  relations: {
    intro: string;
    kinds: { id: string; sym: string; name: string; zh: string }[];
    /** `【…】` marks A, then B. */
    drills: { level: string; text: string; ans: string; why: string }[];
    note: string;
  };
  steps: { no: string; title: string; desc: string }[];
  traps: Record<Trap, { name: string; ja: string; desc: string }>;
  trapExamples: { trap: Trap; text: string; q: string; opt: string; why: string }[];
  examples: { text: string; summary: string; q: ReadingQuestion }[];
}

export interface ReadingBook {
  lesson: ReadingLesson;
  passages: Passage[];
}

/** The book's passages live only in the private data repository. */
export async function loadReading(): Promise<ReadingBook> {
  const key = `reading:${READING_VERSION}`;
  const cached = await loadEntries<ReadingBook>(key);
  if (cached) return cached;
  if (import.meta.env.DEV) {
    // A local copy for development, kept out of the repository.
    const res = await fetch("/.private/reading-n1.json").catch(() => null);
    if (res?.ok) return res.json();
  }
  const book = JSON.parse(await readPrivateText(READING_FILE)) as ReadingBook;
  await saveEntries(key, book);
  return book;
}

/** Quiz result ids, shared with the word quizzes so they sync the same way. */
export const readingId = (passage: string, i: number) => `r:${passage}:${i}`;
export const drillId = (i: number) => `r:rel:${i}`;
export const exampleId = (i: number) => `r:ex:${i}`;
