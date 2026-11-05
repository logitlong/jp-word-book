import { readPrivateText } from "./cloud";
import { loadEntries, saveEntries } from "./store";

/** Bump when the grammar file changes, so devices fetch it again. */
const GRAMMAR_VERSION = 1;
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
  /** Formula blocks: text and kind (`verb` for what comes before, `gram` for the grammar itself, `op` for joins). */
  connect: [string, "verb" | "gram" | "op"][];
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
