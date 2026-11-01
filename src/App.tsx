import { useEffect, useMemo, useRef, useState } from "react";
import { parseApkg, type Note } from "./lib/apkg";
import {
  buildQueue,
  clearAll,
  dayKey,
  emptyProgress,
  grade,
  loadDeck,
  loadProgress,
  loadSettings,
  saveDeck,
  saveProgress,
  saveSettings,
  statusOf,
  defaultSettings,
  type Grade,
  type Progress,
  type Settings,
  type Status,
} from "./lib/store";
import { Rating } from "./lib/store";
import { WordCard } from "./WordCard";

const STATUS_LABEL: Record<Status, string> = { new: "未开始", learning: "学习中", mastered: "已掌握" };
const PAGE = 60;

type Open = { mode: "browse"; id: string } | { mode: "study"; ids: string[]; index: number };

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

function SettingsPanel(props: {
  settings: Settings;
  progress: Progress;
  onChange: (s: Settings) => void;
  onRestore: (p: Progress) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { settings, onChange } = props;
  const exportProgress = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(props.progress)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `背单词进度-${dayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Progress;
      if (!parsed.cards) throw new Error();
      if (confirm("恢复备份会覆盖当前进度，继续吗？")) props.onRestore({ ...emptyProgress(), ...parsed });
    } catch {
      alert("这不是有效的进度备份");
    }
  };
  return (
    <div className="overlay top" onClick={props.onClose}>
      <section className="settings" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <label>每日新词
          <input type="number" min={0} max={200} value={settings.dailyNew}
            onChange={(e) => onChange({ ...settings, dailyNew: Number(e.target.value) })} />
        </label>
        <label>目标记忆率
          <select value={settings.retention} onChange={(e) => onChange({ ...settings, retention: Number(e.target.value) })}>
            {[0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{r * 100}%</option>)}
          </select>
        </label>
        <label>自动播放发音
          <input type="checkbox" checked={settings.autoplay}
            onChange={(e) => onChange({ ...settings, autoplay: e.target.checked })} />
        </label>
        <div className="settings-actions">
          <button className="ghost" onClick={exportProgress}>导出进度</button>
          <label className="ghost file">恢复进度
            <input type="file" accept=".json" onChange={(e) => void restore(e.target.files?.[0])} />
          </label>
          <button className="ghost danger" onClick={props.onReset}>清空牌组和进度</button>
        </div>
        <button className="solid" onClick={props.onClose}>完成</button>
      </section>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [open, setOpen] = useState<Open | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const progressRef = useRef(progress);

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
  const changeSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s);
  };

  const units = useMemo(() => [...new Set((notes ?? []).map((n) => n.unit).filter(Boolean))], [notes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes ?? []).filter(
      (n) =>
        (!unit || n.unit === unit) &&
        (!q || n.word.includes(q) || n.reading.includes(q) || n.meaning.toLowerCase().includes(q)),
    );
  }, [notes, query, unit]);
  useEffect(() => setLimit(PAGE), [query, unit]);

  if (!ready) return null;
  if (!notes) return <Importer onDone={() => void refresh()} />;

  const scope = unit ? notes.filter((n) => n.unit === unit) : notes;
  const queue = buildQueue(scope, progress, settings);
  const mastered = notes.filter((n) => statusOf(n.id, progress) === "mastered").length;
  const learning = notes.filter((n) => statusOf(n.id, progress) === "learning").length;
  const byId = new Map(notes.map((n) => [n.id, n]));

  const startStudy = () => {
    const ids = [...queue.due, ...queue.fresh].map((n) => n.id);
    if (ids.length) setOpen({ mode: "study", ids, index: 0 });
  };

  const onGrade = (id: string, rating: Grade) => {
    update((p) => {
      const isNew = !p.cards[id];
      const key = dayKey();
      return {
        ...p,
        cards: { ...p.cards, [id]: grade(p.cards[id], rating, settings.retention) },
        learned: isNew ? { ...p.learned, [key]: [...(p.learned[key] ?? []), id] } : p.learned,
      };
    });
    setOpen((o) => {
      if (o?.mode !== "study") return o;
      // A forgotten word comes back later in this session.
      const ids = rating === Rating.Again ? [...o.ids, id] : o.ids;
      return o.index + 1 >= ids.length ? null : { ...o, ids, index: o.index + 1 };
    });
  };

  const onStatus = (id: string, status: Status) =>
    update((p) => {
      const cards = { ...p.cards };
      const flags = { ...p.mastered };
      delete flags[id];
      if (status === "new") delete cards[id];
      if (status === "mastered") flags[id] = true;
      if (status === "learning" && !cards[id]) cards[id] = grade(undefined, Rating.Hard, settings.retention);
      return { ...p, cards, mastered: flags };
    });

  const openNote = open
    ? byId.get(open.mode === "study" ? open.ids[open.index] : open.id)
    : undefined;
  const browseIndex = open?.mode === "browse" ? filtered.findIndex((n) => n.id === open.id) : -1;
  const moveBrowse = (step: number) => {
    const next = filtered[(browseIndex + step + filtered.length) % filtered.length];
    if (next) setOpen({ mode: "browse", id: next.id });
  };

  return (
    <div className="page">
      <header className="top-bar">
        <div>
          <h1>{deckName}</h1>
          <p>{notes.length.toLocaleString()} 词 · 学习中 {learning} · 已掌握 {mastered}</p>
        </div>
        <button className="round" onClick={() => setShowSettings(true)} aria-label="设置">⚙</button>
      </header>

      <section className="today">
        <div>
          <b>{queue.due.length}</b><span>待复习</span>
        </div>
        <div>
          <b>{queue.fresh.length}</b><span>今日新词</span>
        </div>
        <button className="solid" disabled={!queue.due.length && !queue.fresh.length} onClick={startStudy}>
          {queue.due.length || queue.fresh.length ? "开始学习" : "今天学完了"}
        </button>
      </section>

      <div className="filters">
        <input type="search" placeholder="搜索单词、假名或中文" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="单元">
          <option value="">全部单元</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <ul className="word-grid">
        {filtered.slice(0, limit).map((n) => {
          const status = statusOf(n.id, progress);
          return (
            <li key={n.id}>
              <button onClick={() => setOpen({ mode: "browse", id: n.id })}>
                <span className={`dot ${status}`} title={STATUS_LABEL[status]} />
                <b>{n.word}</b>
                <small>{n.reading}</small>
                <span className="gloss">{n.meaning}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!filtered.length && <p className="empty">没有找到匹配的单词</p>}
      {filtered.length > limit && (
        <button className="ghost more" onClick={() => setLimit(limit + PAGE)}>再显示 {PAGE} 个</button>
      )}

      {open && openNote && (
        <WordCard
          note={openNote}
          index={open.mode === "study" ? open.index : browseIndex}
          total={open.mode === "study" ? open.ids.length : filtered.length}
          progress={progress}
          settings={settings}
          study={open.mode === "study"}
          tag={[openNote.unit, statusOf(openNote.id, progress) === "new" ? "新词" : STATUS_LABEL[statusOf(openNote.id, progress)]].filter(Boolean).join(" · ")}
          onPrev={() => moveBrowse(-1)}
          onNext={() => moveBrowse(1)}
          onClose={() => setOpen(null)}
          onGrade={(r) => onGrade(openNote.id, r)}
          onStatus={(s) => onStatus(openNote.id, s)}
          onNote={(text) => update((p) => ({ ...p, notes: { ...p.notes, [openNote.id]: text } }))}
          onVoice={(voice) => changeSettings({ ...settings, voice })}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          progress={progress}
          onChange={changeSettings}
          onRestore={(p) => { update(() => p); setShowSettings(false); }}
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
