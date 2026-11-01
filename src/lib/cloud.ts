import { strFromU8, strToU8 } from "fflate";
import type { Note } from "./apkg";
import type { ExamType } from "./examBank";
import { loadAudio, loadEntries, loadToken, saveAudio, saveEntries } from "./store";
import { mergeProgress, type Progress } from "./sync";

const API = "https://api.github.com/repos/logitlong/jp-word-book-data/contents";
/** The word list, entries and deck audio are public; everything else needs a token. */
const PUBLIC_DECK = "https://logitlong.github.io/n1-word-book/deck";
const NEURAL_DIR = "deck/neural";
/** Bump when entry files change, so devices fetch them again. */
const ENTRIES_VERSION = 2;
const PROGRESS_FILE = "progress.json";

export class CloudError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const describe = (status: number) => {
  if (status === 401) return "令牌无效或已过期";
  if (status === 403) return "令牌没有这个仓库的读写权限，或 GitHub 暂时限制了请求";
  if (status === 404) return "找不到私有仓库或文件，请确认令牌选择了 jp-word-book-data";
  return `GitHub 返回错误 ${status}`;
};

async function request(token: string, path: string, accept: string, init?: RequestInit) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  return res;
}

/** Rejects a token that cannot read the private repository. */
export async function checkToken(token: string) {
  const res = await request(token, "README.md", "application/vnd.github.object+json");
  if (!res.ok) throw new CloudError(res.status, describe(res.status));
}

export async function downloadNotes() {
  const res = await fetch(`${PUBLIC_DECK}/notes.json`);
  if (!res.ok) throw new CloudError(res.status, `词库加载失败（${res.status}）`);
  return (await res.json()) as { name: string; notes: Note[] };
}

/** Audio is fetched the first time a word plays, then kept on the device. */
export const loadWordAudio = (name: string) => fetchPublicAudio(name, `audio/${encodeURIComponent(name)}`);

/** The generated neural reading of a word, stored by note id. */
export const loadNeuralAudio = (id: string) => fetchPrivateAudio(`neural:${id}`, `${NEURAL_DIR}/${id}.mp3`);

/** Example sentences are stored as `<note id>-<sense>-<example>`. */
export const loadExampleAudio = (name: string) => fetchPublicAudio(`example:${name}`, `examples/${name}.mp3`);

async function fetchPublicAudio(key: string, path: string) {
  const cached = await loadAudio(key);
  if (cached) return cached;
  const res = await fetch(`${PUBLIC_DECK}/${path}`).catch(() => null);
  if (!res?.ok) return undefined;
  const blob = new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
  await saveAudio(key, blob);
  return blob;
}

async function fetchPrivateAudio(key: string, path: string) {
  const cached = await loadAudio(key);
  if (cached) return cached;
  const token = await loadToken();
  if (!token) return undefined;
  const res = await request(token, path, "application/vnd.github.raw+json").catch(() => null);
  if (!res?.ok) return undefined;
  const blob = new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
  await saveAudio(key, blob);
  return blob;
}

export interface Sense {
  pos: string;
  zh: string;
  ja: string;
  examples: { ja: string; zh: string }[];
}

export interface WordEntry {
  id: string;
  word: string;
  senses: Sense[];
  exams: { type: ExamType; stem: string; options: string[] }[];
}

type UnitEntries = Record<string, WordEntry>;
const unitEntries = new Map<string, Promise<UnitEntries>>();

async function fetchUnitEntries(number: string) {
  const key = `${ENTRIES_VERSION}:${number}`;
  const cached = await loadEntries<UnitEntries>(key);
  if (cached) return cached;
  const res = await fetch(`${PUBLIC_DECK}/entries/u${number.padStart(2, "0")}.json`);
  if (!res.ok) return {};
  const list = (await res.json()) as WordEntry[];
  const entries = Object.fromEntries(list.map((entry) => [entry.id, entry]));
  await saveEntries(key, entries);
  return entries;
}

/** Rewritten entries for a deck unit; units without them yet resolve to nothing. */
export function loadUnitEntries(unit: string) {
  const number = unit.match(/(\d+)$/)?.[1];
  if (!number) return Promise.resolve<UnitEntries>({});
  if (!unitEntries.has(number)) {
    const pending = fetchUnitEntries(number).catch(() => {
      unitEntries.delete(number);
      return {};
    });
    unitEntries.set(number, pending);
  }
  return unitEntries.get(number)!;
}

/** Files over 1MB come back without content from the JSON view, so the sha and the body are separate calls. */
async function remoteSha(token: string) {
  const res = await request(token, PROGRESS_FILE, "application/vnd.github.object+json");
  if (res.status === 404) return null;
  if (!res.ok) throw new CloudError(res.status, describe(res.status));
  return (await res.json()).sha as string;
}

async function readRemote(token: string) {
  const res = await request(token, PROGRESS_FILE, "application/vnd.github.raw+json");
  if (!res.ok) throw new CloudError(res.status, describe(res.status));
  return JSON.parse(strFromU8(new Uint8Array(await res.arrayBuffer()))) as Partial<Progress>;
}

function toBase64(text: string) {
  const bytes = strToU8(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function writeRemote(token: string, progress: Progress, sha: string | null) {
  const res = await request(token, PROGRESS_FILE, "application/vnd.github+json", {
    method: "PUT",
    body: JSON.stringify({
      message: "Update study progress",
      content: toBase64(JSON.stringify(progress)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new CloudError(res.status, describe(res.status));
  return (await res.json()).content.sha as string;
}

export interface SyncResult {
  progress: Progress;
  sha: string;
}

/**
 * Merges the cloud copy into `local` and writes the result back when it holds anything new.
 * Another device can write between the read and the write, so a sha conflict restarts once.
 */
export async function syncProgress(token: string, local: Progress, lastSha: string | null, retry = true): Promise<SyncResult> {
  const sha = await remoteSha(token);
  if (sha && sha === lastSha && !local.dirty) return { progress: local, sha };
  const merged = sha ? mergeProgress(local, await readRemote(token)) : { ...local };
  const clean = { ...merged, dirty: false };
  // A device with nothing new only takes the cloud copy, so two devices never trade empty commits.
  if (sha && !local.dirty) return { progress: clean, sha };
  try {
    const nextSha = await writeRemote(token, clean, sha);
    return { progress: clean, sha: nextSha };
  } catch (e) {
    if (retry && e instanceof CloudError && (e.status === 409 || e.status === 422)) {
      return syncProgress(token, local, null, false);
    }
    throw e;
  }
}
