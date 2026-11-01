const SMALL = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

/** Split kana into morae. Small kana join the previous mora; ん, っ and ー count on their own. */
export function toMorae(kana: string): string[] {
  const morae: string[] = [];
  for (const ch of kana) {
    if (SMALL.has(ch) && morae.length) morae[morae.length - 1] += ch;
    else morae.push(ch);
  }
  return morae;
}

const CIRCLED = "⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** Parse a deck accent field such as "③", "◎①", "⓪①" or "0,2" into accent positions. ◎ marks heiban. */
export function parseAccents(raw: string): number[] {
  const accents: number[] = [];
  for (const ch of raw) {
    const i = ch === "◎" ? 0 : CIRCLED.indexOf(ch);
    if (i >= 0 && !accents.includes(i)) accents.push(i);
  }
  if (accents.length) return accents;
  return [...new Set((raw.match(/\d+/g) ?? []).map(Number))];
}

export const circled = (n: number) => CIRCLED[n] ?? String(n);

/** Reading without the symbols that carry no mora, as in "～ばんち" or "ほどほど（に）". */
export const pitchKana = (reading: string) => reading.replace(/[（(][^）)]*[）)]/g, "").replace(/[～~‐\-]/g, "");

/** A deck typo such as ⑫ on a four-mora word has no drawable pattern. */
export const isDrawable = (reading: string, accent: number) => accent <= toMorae(pitchKana(reading)).length;

export interface PitchMora {
  text: string;
  high: boolean;
  /** Pitch changes right before this mora, so the line steps between top and bottom. */
  step: boolean;
  /** Pitch falls right after this mora. */
  drop: boolean;
}

export function pitchPattern(kana: string, accent: number): PitchMora[] {
  const isHigh = (pos: number) =>
    accent === 0 ? pos > 1 : accent === 1 ? pos === 1 : pos > 1 && pos <= accent;
  return toMorae(pitchKana(kana)).map((text, i) => {
    const pos = i + 1;
    return {
      text,
      high: isHigh(pos),
      step: pos > 1 && isHigh(pos) !== isHigh(pos - 1),
      drop: accent > 0 && pos === accent,
    };
  });
}

export function accentType(kana: string, accent: number) {
  if (accent === 0) return "平板型";
  if (accent === 1) return "头高型";
  return accent >= toMorae(pitchKana(kana)).length ? "尾高型" : "中高型";
}

/** Strips real HTML tags only: the deck also uses "<数>" and "<书信>" as subject labels. */
const clean = (raw: string) => raw.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

/**
 * Split Anki furigana into the written word and its reading.
 * "案じる[あんじる]" brackets the whole word; "食[た]べる" brackets only the kanji.
 */
export function parseWord(raw: string) {
  const text = clean(raw);
  const word = text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
  const brackets = [...text.matchAll(/\[([^\]]+)\]/g)];
  if (!brackets.length) return { word, reading: word };
  if (brackets.length === 1 && text.endsWith("]")) return { word, reading: brackets[0][1] };
  const reading = text
    .replace(/[^\s\[\]]*?([^぀-ヿ\s\[\]]+)\[([^\]]+)\]/g, (m, kanji: string, kana: string) =>
      m.slice(0, m.length - kanji.length - kana.length - 2) + kana,
    )
    .replace(/\s+/g, "");
  return { word, reading };
}

export const cleanText = clean;
