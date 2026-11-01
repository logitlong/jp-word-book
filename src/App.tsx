import { useEffect, useMemo, useRef, useState } from "react";
import { parseApkg, type Note } from "./lib/apkg";
import { CloudError, downloadNotes, syncProgress } from "./lib/cloud";
import { mergeProgress, stampChanges } from "./lib/sync";
import {
  buildGroups,
  clearAll,
  clearToken,
  dayKey,
  defaultSettings,
  emptyProgress,
  grade,
  loadDeck,
  loadProgress,
  loadSettings,
  loadSyncSha,
  loadToken,
  Rating,
  saveDeck,
  saveProgress,
  saveSettings,
  saveSyncSha,
  saveToken,
  STATUS_LABEL,
  statusOf,
  type Grade,
  type Group,
  type Progress,
  type Settings,
  type Status,
} from "./lib/store";
import { GroupsPage, SettingsPanel, StatsPage, TodayPage, WordsPage, type WordFilter } from "./pages";
import { Quiz } from "./Quiz";
import { WordCard } from "./WordCard";

const SYNC_DELAY = 15000;
export const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

type SyncState =
  | { status: "idle" | "syncing"; at?: Date }
  | { status: "ok"; at: Date }
  | { status: "error"; message: string };

function syncLabel(sync: SyncState) {
  if (sync.status === "error") return "同步失败";
  if (sync.status === "syncing") return "同步中…";
  if (sync.status === "ok") {
    return `已同步 ${sync.at.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return "云同步已连接";
}

type Tab = "today" | "groups" | "words" | "stats";

const TABS: { value: Tab; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "groups", label: "单元" },
  { value: "words", label: "词表" },
  { value: "stats", label: "统计" },
];

interface StudySession {
  title: string;
  ids: string[];
  index: number;
  again: number;
  familiar: number;
}

type Open = { mode: "browse"; id: string; list: string[] } | { mode: "study"; session: StudySession };

interface Summary {
  title: string;
  total: number;
  again: number;
  familiar: number;
}

function Importer({ savedToken, onDone }: { savedToken?: string; onDone: (token?: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const started = useRef(false);

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : "导入失败");
    setBusy("");
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy("正在解析牌组…");
    setError("");
    try {
      await saveDeck(await parseApkg(file.name, new Uint8Array(await file.arrayBuffer())));
      onDone();
    } catch (e) {
      fail(e);
    }
  };
  const connect = async (value: string) => {
    setBusy("正在连接私有仓库…");
    setError("");
    try {
      const { name, notes } = await downloadNotes(value);
      await saveDeck({ name, notes, audio: new Map() });
      await saveToken(value);
      onDone(value);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) await clearToken();
      fail(e);
    }
  };
  useEffect(() => {
    if (savedToken && !started.current) {
      started.current = true;
      void connect(savedToken);
    }
    // Runs once for a device that already holds a token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedToken]);

  return (
    <main className="importer">
      <h1>背单词</h1>
      <section className="connect">
        <h2>连接我的私有仓库</h2>
        <p>每台设备只需填一次。之后打开网址就能用，音频播放时才加载。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void connect(token.trim());
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴 GitHub 访问令牌"
            aria-label="GitHub 访问令牌"
            value={token}
            disabled={!!busy}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="solid" disabled={!!busy || !token.trim()}>连接</button>
        </form>
        <a href={TOKEN_URL} target="_blank" rel="noreferrer">去 GitHub 生成令牌</a>
      </section>
      {busy && <p aria-live="polite">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <label className={`ghost file${busy ? " busy" : ""}`}>
        或选择本机 .apkg 文件
        <input type="file" accept=".apkg" disabled={!!busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
    </main>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [tab, setTab] = useState<Tab>("today");
  const [open, setOpen] = useState<Open | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [quiz, setQuiz] = useState<Group | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<WordFilter>("all");
  const [groupKey, setGroupKey] = useState("");
  const progressRef = useRef(progress);
  const undoStack = useRef<{ progress: Progress; session: StudySession }[]>([]);

  const [token, setToken] = useState<string | undefined>();
  const [sync, setSync] = useState<SyncState>({ status: "idle" });
  const shaRef = useRef<string | null>(null);
  const syncing = useRef(false);
  const syncTimer = useRef<number | undefined>(undefined);

  const refresh = async (nextToken?: string) => {
    const [deck, p, s, savedToken, sha] = await Promise.all([loadDeck(), loadProgress(), loadSettings(), loadToken(), loadSyncSha()]);
    setDeckName(deck.name ?? "");
    setNotes(deck.notes ?? null);
    setProgress(p);
    progressRef.current = p;
    setSettings(s);
    shaRef.current = sha ?? null;
    setToken(nextToken ?? savedToken);
    setReady(true);
  };
  useEffect(() => void refresh(), []);

  const runSync = async () => {
    if (!token || syncing.current) return;
    syncing.current = true;
    setSync((s) => ({ ...s, status: "syncing" }));
    const snapshot = progressRef.current;
    try {
      const result = await syncProgress(token, snapshot, shaRef.current);
      shaRef.current = result.sha;
      void saveSyncSha(result.sha);
      // Words graded while the request ran stay local and go out with the next sync.
      const latest = progressRef.current;
      const next = latest === snapshot ? result.progress : { ...mergeProgress(latest, result.progress), dirty: true };
      progressRef.current = next;
      setProgress(next);
      void saveProgress(next);
      setSync({ status: "ok", at: new Date() });
      if (next.dirty) schedule();
    } catch (e) {
      setSync({ status: "error", message: e instanceof Error ? e.message : "同步失败" });
    } finally {
      syncing.current = false;
    }
  };
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  const schedule = () => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void runSyncRef.current(), SYNC_DELAY);
  };

  useEffect(() => {
    if (!token) return;
    void runSyncRef.current();
    const onVisibility = () => void runSyncRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [token]);

  const update = (fn: (p: Progress) => Progress) => {
    const prev = progressRef.current;
    const next = stampChanges(prev, fn(prev));
    progressRef.current = next;
    setProgress(next);
    void saveProgress(next);
    if (token) schedule();
  };
  const changeSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  };

  const groups = useMemo(() => buildGroups(notes ?? [], settings), [notes, settings.groupBy, settings.groupSize]);
  const byId = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes]);

  if (!ready) return null;
  if (!notes) return <Importer savedToken={token} onDone={(value) => void refresh(value)} />;

  const startStudy = (title: string, ids: string[]) => {
    if (!ids.length) return;
    undoStack.current = [];
    setOpen({ mode: "study", session: { title, ids, index: 0, again: 0, familiar: 0 } });
  };

  /** Moves past the current card, or closes the session with its summary after the last one. */
  const advance = (session: StudySession) => {
    if (session.index + 1 < session.ids.length) {
      setOpen({ mode: "study", session: { ...session, index: session.index + 1 } });
      return;
    }
    setOpen(null);
    setSummary({
      title: session.title,
      total: new Set(session.ids).size,
      again: session.again,
      familiar: session.familiar,
    });
  };

  const onGrade = (session: StudySession, id: string, rating: Grade) => {
    undoStack.current.push({ progress: progressRef.current, session });
    update((p) => {
      const isNew = !p.cards[id];
      const key = dayKey();
      const day = p.log[key] ?? { new: 0, review: 0, again: 0 };
      return {
        ...p,
        cards: { ...p.cards, [id]: grade(p.cards[id], rating, settings.retention) },
        learned: isNew ? { ...p.learned, [key]: [...(p.learned[key] ?? []), id] } : p.learned,
        log: {
          ...p.log,
          [key]: {
            new: day.new + (isNew ? 1 : 0),
            review: day.review + (isNew ? 0 : 1),
            again: day.again + (!isNew && rating === Rating.Again ? 1 : 0),
          },
        },
      };
    });
    // A forgotten word comes back later in this session.
    const forgotten = rating === Rating.Again;
    advance({
      ...session,
      ids: forgotten ? [...session.ids, id] : session.ids,
      again: session.again + (forgotten ? 1 : 0),
    });
  };

  const onFamiliar = (session: StudySession, id: string) => {
    undoStack.current.push({ progress: progressRef.current, session });
    update((p) => ({ ...p, familiar: { ...p.familiar, [id]: true } }));
    const ids = session.ids.filter((other, i) => i <= session.index || other !== id);
    advance({ ...session, ids, familiar: session.familiar + 1 });
  };

  const onUndo = () => {
    const last = undoStack.current.pop();
    if (!last) return;
    update(() => last.progress);
    setSummary(null);
    setOpen({ mode: "study", session: last.session });
  };

  const onStatus = (id: string, status: Status) =>
    update((p) => {
      const cards = { ...p.cards };
      const familiar = { ...p.familiar };
      delete familiar[id];
      if (status === "new") delete cards[id];
      if (status === "familiar") familiar[id] = true;
      if (status === "learning" && !cards[id]) cards[id] = grade(undefined, Rating.Hard, settings.retention);
      return { ...p, cards, familiar };
    });

  const toggleStar = (id: string) =>
    update((p) => {
      const starred = { ...p.starred };
      if (starred[id]) delete starred[id];
      else starred[id] = true;
      return { ...p, starred };
    });

  const session = open?.mode === "study" ? open.session : null;
  const openNote = open ? byId.get(session ? session.ids[session.index] : (open as { id: string }).id) : undefined;
  const browseIndex = open?.mode === "browse" ? open.list.indexOf(open.id) : -1;
  const moveBrowse = (step: number) => {
    if (open?.mode !== "browse") return;
    const id = open.list[(browseIndex + step + open.list.length) % open.list.length];
    if (id) setOpen({ ...open, id });
  };
  const noteStatus = openNote ? statusOf(openNote.id, progress) : "new";

  return (
    <div className="page">
      <header className="top-bar">
        <div>
          <h1>{deckName}</h1>
          <p>{notes.length.toLocaleString()} 词{token ? ` · ${syncLabel(sync)}` : ""}</p>
        </div>
        <nav className="tabs" aria-label="页面">
          {TABS.map((t) => (
            <button key={t.value} className={tab === t.value ? "active" : ""} aria-current={tab === t.value ? "page" : undefined} onClick={() => setTab(t.value)}>
              {t.label}
            </button>
          ))}
        </nav>
        <button className="round" onClick={() => setShowSettings(true)} aria-label="设置">⚙</button>
      </header>

      {tab === "today" && (
        <TodayPage
          notes={notes}
          groups={groups}
          progress={progress}
          settings={settings}
          onStudy={startStudy}
          onMode={(mode) => changeSettings({ mode })}
        />
      )}
      {tab === "groups" && (
        <GroupsPage
          groups={groups}
          progress={progress}
          settings={settings}
          onSettings={changeSettings}
          onStudy={startStudy}
          onQuiz={setQuiz}
          onBrowse={(group) => {
            setGroupKey(group.key);
            setFilter("all");
            setTab("words");
          }}
        />
      )}
      {tab === "words" && (
        <WordsPage
          notes={notes}
          groups={groups}
          progress={progress}
          filter={filter}
          groupKey={groupKey}
          onFilter={setFilter}
          onGroup={setGroupKey}
          onOpen={(id, list) => setOpen({ mode: "browse", id, list })}
          onStudy={startStudy}
          onStar={toggleStar}
          onUnfamiliar={(id) => onStatus(id, progress.cards[id] ? "learning" : "new")}
        />
      )}
      {tab === "stats" && <StatsPage notes={notes} progress={progress} />}

      {open && openNote && (
        <WordCard
          key={session ? `${openNote.id}-${session.index}` : "browse"}
          note={openNote}
          index={session ? session.index : browseIndex}
          total={session ? session.ids.length : open.mode === "browse" ? open.list.length : 0}
          progress={progress}
          settings={settings}
          study={!!session}
          tag={[session?.title ?? openNote.unit, STATUS_LABEL[noteStatus]].filter(Boolean).join(" · ")}
          canUndo={undoStack.current.length > 0}
          onPrev={() => moveBrowse(-1)}
          onNext={() => moveBrowse(1)}
          onClose={() => setOpen(null)}
          onGrade={(r) => session && onGrade(session, openNote.id, r)}
          onStatus={(s) => onStatus(openNote.id, s)}
          onNote={(text) => update((p) => ({ ...p, notes: { ...p.notes, [openNote.id]: text } }))}
          onVoice={(voice) => changeSettings({ voice })}
          onSettings={() => setShowSettings(true)}
          onStar={() => toggleStar(openNote.id)}
          onFamiliar={() => session && onFamiliar(session, openNote.id)}
          onUndo={onUndo}
        />
      )}

      {summary && (
        <div className="overlay" onClick={() => setSummary(null)}>
          <section className="sheet" role="dialog" aria-label="本轮完成" onClick={(e) => e.stopPropagation()}>
            <p className="sheet-meta">{summary.title} · 本轮完成</p>
            <h2 className="sheet-title">背完 {summary.total} 个词</h2>
            <p className="sheet-note">忘记 {summary.again} 次 · 标记已熟悉 {summary.familiar} 个</p>
            <div className="sheet-actions">
              {undoStack.current.length > 0 && <button className="ghost" onClick={onUndo}>撤销上一步</button>}
              <button className="solid" onClick={() => setSummary(null)}>完成</button>
            </div>
          </section>
        </div>
      )}

      {quiz && (
        <Quiz
          title={quiz.title}
          scope={quiz.notes}
          pool={notes}
          onClose={() => setQuiz(null)}
          onStarWrong={(ids) =>
            update((p) => ({ ...p, starred: { ...p.starred, ...Object.fromEntries(ids.map((id) => [id, true])) } }))
          }
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          progress={progress}
          cloud={{
            connected: !!token,
            label: syncLabel(sync),
            error: sync.status === "error" ? sync.message : undefined,
            onConnect: (value) => {
              void saveToken(value);
              setToken(value);
            },
            onSyncNow: () => void runSync(),
            onDisconnect: () => {
              void clearToken();
              setToken(undefined);
              setSync({ status: "idle" });
            },
          }}
          onChange={changeSettings}
          onRestore={(p) => {
            update(() => p);
            setShowSettings(false);
          }}
          onReset={() => {
            if (!confirm("确定清空牌组和全部学习进度吗？这一步不能撤销，建议先导出进度。")) return;
            void clearAll().then(() => location.reload());
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
