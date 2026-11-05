import { readPrivateText } from "./cloud";
import { loadEntries, saveEntries } from "./store";
import type { QuizResult } from "./sync";

/** Bump when the grammar file changes, so devices fetch it again. */
const GRAMMAR_VERSION = 2;
const GRAMMAR_FILE = "deck/grammar/n1.json";

export interface GrammarCategory {
  id: string;
  no: number;
  name: string;
  zh: string;
  ready?: boolean;
}

export interface GrammarItem {
  id: string;
  pattern: string;
  alt: string;
  zh: string;
  ja: string;
  /** Formula rows, one per way to connect; each block is text and kind (`verb` for what comes before, `gram` for the grammar itself, `op` for joins). */
  connect: [string, "verb" | "gram" | "op"][][];
  colloc: string[];
  /** `【…】` marks the grammar part of each sentence. */
  examples: { ja: string; zh: string }[];
  notes: string[];
}

export interface GrammarQuiz {
  q: string;
  opts: string[];
  /** 1-based, as printed in the book. */
  ans: number;
  item: string;
  why: string;
}

export interface GrammarSort {
  pre: string;
  post: string;
  pieces: string[];
  /** Option numbers in the right order. */
  order: number[];
  /** Which blank, 1-based, carries the ★. */
  star: number;
  item: string;
}

export interface GrammarUnit {
  intro: {
    core: string;
    flow: { a: string; expect: string; real: string };
    groups: { id: string; title: string; desc: string; items: string[] }[];
  };
  items: GrammarItem[];
  compare: { a: string; b: string; point: string }[];
  quiz: GrammarQuiz[];
  sort: GrammarSort[];
}

export interface GrammarBook {
  categories: GrammarCategory[];
  data: Record<string, GrammarUnit>;
}

/** The book's content lives only in the private data repository. */
export async function loadGrammar(): Promise<GrammarBook> {
  const key = `grammar:${GRAMMAR_VERSION}`;
  const cached = await loadEntries<GrammarBook>(key);
  if (cached) return cached;
  let book: GrammarBook;
  if (import.meta.env.DEV) {
    // A local copy for development, kept out of the repository.
    const res = await fetch("/.private/grammar-n1.json").catch(() => null);
    book = res?.ok ? await res.json() : JSON.parse(await readPrivateText(GRAMMAR_FILE));
    return book;
  }
  book = JSON.parse(await readPrivateText(GRAMMAR_FILE));
  await saveEntries(key, book);
  return book;
}

/** Quiz result ids, shared with the word quizzes so they sync the same way. */
export const checkId = (cat: string, item: string) => `g:${cat}:c:${item}`;
export const quizId = (cat: string, i: number) => `g:${cat}:q:${i}`;
export const sortId = (cat: string, i: number) => `g:${cat}:s:${i}`;

type Results = Record<string, QuizResult>;

const STEP_KEY = "grammar-step:";
/** Where a category's lesson was left on this device. */
export const savedStep = (cat: string) => {
  try {
    return Number(localStorage.getItem(STEP_KEY + cat)) || 0;
  } catch {
    return 0;
  }
};
export const saveStep = (cat: string, i: number) => {
  try {
    localStorage.setItem(STEP_KEY + cat, String(i));
  } catch {
    /* Only a convenience: the lesson starts from the top instead. */
  }
};
/** Overview, grammar points, comparison, both question sets and the summary. */
export const stepCount = (unit: GrammarUnit) => unit.items.length + unit.quiz.length + unit.sort.length + 3;

/** Share of right answers among the questions that test this grammar point. */
export function mastery(cat: string, unit: GrammarUnit, id: string, results: Results) {
  const ids = [
    checkId(cat, id),
    ...unit.quiz.flatMap((q, i) => (q.item === id ? [quizId(cat, i)] : [])),
    ...unit.sort.flatMap((q, i) => (q.item === id ? [sortId(cat, i)] : [])),
  ].filter((qid) => results[qid]);
  return ids.length ? ids.filter((qid) => results[qid].ok).length / ids.length : 0;
}

export const unitProgress = (cat: string, unit: GrammarUnit, results: Results) =>
  unit.items.reduce((sum, it) => sum + mastery(cat, unit, it.id, results), 0) / unit.items.length;

/** Book questions (問題5 and 問題6) answered and answered wrong, across all categories. */
export function grammarScore(book: GrammarBook, results: Results) {
  let done = 0, ok = 0, wrong = 0, total = 0;
  for (const [cat, unit] of Object.entries(book.data)) {
    const ids = [...unit.quiz.map((_, i) => quizId(cat, i)), ...unit.sort.map((_, i) => sortId(cat, i))];
    total += ids.length;
    for (const id of ids) {
      if (!results[id]) continue;
      done++;
      if (results[id].ok) ok++;
      else wrong++;
    }
  }
  return { done, ok, wrong, total };
}
