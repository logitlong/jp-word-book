import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { strFromU8, unzipSync } from "fflate";
import { decompress } from "fzstd";
import { cleanText, parseAccents, parseWord } from "./pitch";

export interface Note {
  id: string;
  order: number;
  word: string;
  reading: string;
  pos: string;
  meaning: string;
  unit: string;
  accents: number[];
  audio: string;
}

export interface ParsedDeck {
  name: string;
  notes: Note[];
  audio: Map<string, Uint8Array>;
}

const isZstd = (b: Uint8Array) => b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
const unzstd = (b: Uint8Array) => (isZstd(b) ? decompress(b) : b);

const rows = (db: Database, sql: string) => db.exec(sql)[0]?.values ?? [];

/** Field names per notetype id: new packages have a fields table, old ones keep JSON in col. */
function fieldNames(db: Database) {
  const byModel = new Map<string, Record<string, number>>();
  const tables = rows(db, "select name from sqlite_master where type='table'").map((r) => r[0]);
  if (tables.includes("fields")) {
    for (const [ntid, ord, name] of rows(db, "select ntid, ord, name from fields")) {
      const key = String(ntid);
      byModel.set(key, { ...byModel.get(key), [String(name)]: Number(ord) });
    }
    return byModel;
  }
  const models = JSON.parse(String(rows(db, "select models from col")[0][0]));
  for (const [id, model] of Object.entries<{ flds: { name: string; ord: number }[] }>(models)) {
    byModel.set(id, Object.fromEntries(model.flds.map((f) => [f.name, f.ord])));
  }
  return byModel;
}

/** Minimal protobuf read of the new media map: repeated entry { 1: name }. Entry index is the zip name. */
function parseMediaEntries(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  const names: Record<string, string> = {};
  const varint = (buf: Uint8Array, start: number) => {
    let value = 0;
    let shift = 0;
    let pos = start;
    while (buf[pos] & 0x80) {
      value += (buf[pos++] & 0x7f) * 2 ** shift;
      shift += 7;
    }
    value += buf[pos++] * 2 ** shift;
    return [value, pos] as const;
  };
  let pos = 0;
  let index = 0;
  while (pos < bytes.length) {
    const [tag, afterTag] = varint(bytes, pos);
    const [length, start] = varint(bytes, afterTag);
    if (tag >> 3 === 1 && (tag & 7) === 2) {
      const entry = bytes.subarray(start, start + length);
      const [innerTag, afterInner] = varint(entry, 0);
      if (innerTag === 0x0a) {
        const [nameLength, nameStart] = varint(entry, afterInner);
        names[String(index)] = decoder.decode(entry.subarray(nameStart, nameStart + nameLength));
      }
      index += 1;
    }
    pos = start + length;
  }
  return names;
}

function parseMediaMap(raw: Uint8Array | undefined) {
  if (!raw) return {};
  const bytes = unzstd(raw);
  if (bytes[0] === 0x7b) return JSON.parse(strFromU8(bytes)) as Record<string, string>;
  return parseMediaEntries(bytes);
}

const firstKana = (reading: string) => {
  const code = reading.codePointAt(0) ?? 0;
  return code >= 0x30a1 && code <= 0x30f6 ? code - 0x60 : code;
};

/** The deck stores some units from わ back to あ; those run backwards, and units in another order stay as they are. */
export function restoreKanaOrder(notes: Note[]) {
  const units = new Map<string, Note[]>();
  for (const note of notes) units.set(note.unit, [...(units.get(note.unit) ?? []), note]);
  return [...units.values()]
    .flatMap((unit) => {
      const kana = unit.map((n) => firstKana(n.reading));
      const rises = kana.filter((k, i) => i > 0 && k > kana[i - 1]).length;
      const falls = kana.filter((k, i) => i > 0 && k < kana[i - 1]).length;
      return falls > rises * 2 ? [...unit].reverse() : unit;
    })
    .map((note, i) => ({ ...note, order: i }));
}

export async function parseApkg(fileName: string, data: Uint8Array): Promise<ParsedDeck> {
  const zip = unzipSync(data);
  const raw = zip["collection.anki21b"] ?? zip["collection.anki21"] ?? zip["collection.anki2"];
  if (!raw) throw new Error("这个文件里没有 Anki 数据，请确认选择的是 .apkg 牌组");

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(unzstd(raw));
  try {
    const fields = fieldNames(db);
    const notes: Note[] = [];
    for (const [id, mid, flds] of rows(db, "select id, mid, flds from notes")) {
      const map = fields.get(String(mid));
      if (!map || map["日文"] === undefined) continue;
      const parts = String(flds).split("\x1f");
      const get = (name: string) => cleanText(parts[map[name]] ?? "");
      const { word, reading } = parseWord(parts[map["日文"]] ?? "");
      if (!word) continue;
      const rawAudio = parts[map["音频"]] ?? "";
      notes.push({
        id: String(id),
        order: Number(get("排序编号")) || notes.length,
        word,
        reading,
        pos: get("词性"),
        meaning: get("释义"),
        unit: get("课号"),
        accents: parseAccents(get("音调")),
        audio: rawAudio.match(/\[sound:([^\]]+)\]/)?.[1] ?? "",
      });
    }
    if (!notes.length) throw new Error("没有找到“日文”字段，这个牌组的格式和绿宝书牌组不同");
    notes.sort((a, b) => a.order - b.order);
    const ordered = restoreKanaOrder(notes);

    const wanted = new Set(notes.map((n) => n.audio).filter(Boolean));
    const audio = new Map<string, Uint8Array>();
    for (const [zipName, mediaName] of Object.entries(parseMediaMap(zip["media"]))) {
      if (wanted.has(mediaName) && zip[zipName]) audio.set(mediaName, unzstd(zip[zipName]));
    }
    return { name: fileName.replace(/\.apkg$/i, ""), notes: ordered, audio };
  } finally {
    db.close();
  }
}
