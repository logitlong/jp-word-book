import { useEffect, useMemo, useRef, useState } from "react";
import { parseApkg, type Note } from "./lib/apkg";
import {
  buildGroups,
  clearAll,
  dayKey,
  defaultSettings,
  emptyProgress,
  grade,
  loadDeck,
  loadProgress,
  loadSettings,
  Rating,
  saveDeck,
  saveProgress,
  saveSettings,
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

function Importer({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await saveDeck(await parseApkg(file.name, new Uint8Array(await file.arrayBuffer())));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
      setBusy(false);
    }
  };
  return (
    <main className="importer">
      <h1>背单词</h1>
      <p>选择你下载的 Anki 牌组（.apkg）。文件只在这个浏览器里解析和保存，不会上传。</p>
      <label className={`solid file${busy ? " busy" : ""}`}>
        {busy ? "正在解析牌组…" : "选择 .apkg 文件"}
        <input type="file" accept=".apkg" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {error && <p className="error">{error}</p>}
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

  const refresh = async () => {
    const [deck, p, s] = await Promise.all([loadDeck(), loadProgress(), loadSettings()]);
    setDeckName(deck.name ?? "");
    setNotes(deck.notes ?? null);
    setProgress(p);
    progressRef.current = p;
    setSettings(s);
    setReady(true);
  };
  useEffect(() => void refresh(), []);

  const update = (fn: (p: Progress) => Progress) => {
    const next = fn(progressRef.current);
    progressRef.current = next;
    setProgress(next);
    void saveProgress(next);
  };
  const changeSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  };

  const groups = useMemo(() => buildGroups(notes ?? [], settings), [notes, settings.groupBy, settings.groupSize]);
  const byId = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes]);

  if (!ready) return null;
  if (!notes) return <Importer onDone={() => void refresh()} />;

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
          <p>{notes.length.toLocaleString()} 词</p>
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
