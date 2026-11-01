import { useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import {
  buildQueue,
  dayKey,
  forecast,
  GROUP_SIZE_MAX,
  GROUP_SIZE_MIN,
  isDue,
  isUnseen,
  LEECH_LAPSES,
  normalizeProgress,
  recentDays,
  STATUS_LABEL,
  statusOf,
  streak,
  type Group,
  type Progress,
  type Settings,
  type Status,
  type StudyMode,
} from "./lib/store";

const MODES: { value: StudyMode; label: string; hint: string }[] = [
  { value: "read", label: "认词", hint: "看单词想释义" },
  { value: "listen", label: "听音", hint: "听发音想单词" },
  { value: "recall", label: "回想", hint: "看释义想单词" },
];

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} className={props.value === o.value ? "active" : ""} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const countOf = (notes: Note[], p: Progress, status: Status) =>
  notes.filter((n) => statusOf(n.id, p) === status).length;

/** First group that still has unseen words: where "continue" picks up. */
export const currentGroup = (groups: Group[], p: Progress) =>
  groups.find((g) => g.notes.some((n) => isUnseen(n.id, p)));

export function TodayPage(props: {
  notes: Note[];
  groups: Group[];
  progress: Progress;
  settings: Settings;
  onStudy: (title: string, ids: string[]) => void;
  onMode: (mode: StudyMode) => void;
}) {
  const { notes, groups, progress, settings } = props;
  const queue = buildQueue(notes, progress, settings);
  const log = progress.log[dayKey()];
  const learnedToday = progress.learned[dayKey()]?.length ?? 0;
  const goal = Math.min(100, Math.round((learnedToday / Math.max(1, settings.dailyNew)) * 100));
  const group = currentGroup(groups, progress);
  const ids = [...queue.due, ...queue.fresh].map((n) => n.id);
  const groupLeft = group?.notes.filter((n) => isUnseen(n.id, progress)) ?? [];

  return (
    <>
      <section className="today">
        <div className="today-stats">
          <div><b>{queue.due.length}</b><span>待复习</span></div>
          <div><b>{queue.fresh.length}</b><span>今日新词</span></div>
          <div><b>{(log?.new ?? 0) + (log?.review ?? 0)}</b><span>今日已背</span></div>
          <div><b>{streak(progress)}</b><span>连续打卡（天）</span></div>
        </div>
        <div className="goal" role="progressbar" aria-valuenow={goal} aria-valuemin={0} aria-valuemax={100} aria-label="今日新词目标">
          <i style={{ width: `${goal}%` }} />
        </div>
        <p className="goal-text">今日新词 {learnedToday} / {settings.dailyNew}</p>
        <div className="today-actions">
          <button className="solid" disabled={!ids.length} onClick={() => props.onStudy("今日学习", ids)}>
            {ids.length ? `开始学习 ${ids.length} 个` : "今天学完了"}
          </button>
          {group && (
            <button className="ghost" onClick={() => props.onStudy(group.title, groupLeft.map((n) => n.id))}>
              继续{group.title}（剩 {groupLeft.length} 词）
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>学习方式</h2>
        <Segmented label="学习方式" value={settings.mode} options={MODES} onChange={props.onMode} />
        <p className="muted">{MODES.find((m) => m.value === settings.mode)?.hint}</p>
      </section>

      <section className="overview">
        {(["new", "learning", "mastered", "familiar"] as Status[]).map((s) => (
          <div key={s}><b>{countOf(notes, progress, s).toLocaleString()}</b><span>{STATUS_LABEL[s]}</span></div>
        ))}
      </section>
    </>
  );
}

export function GroupsPage(props: {
  groups: Group[];
  progress: Progress;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onStudy: (title: string, ids: string[]) => void;
  onQuiz: (group: Group) => void;
  onBrowse: (group: Group) => void;
}) {
  const { groups, progress, settings } = props;
  const [draft, setDraft] = useState(String(settings.groupSize));
  const commitSize = () => {
    const size = Math.min(GROUP_SIZE_MAX, Math.max(GROUP_SIZE_MIN, Number(draft) || GROUP_SIZE_MIN));
    setDraft(String(size));
    props.onSettings({ groupSize: size });
  };

  return (
    <>
      <section className="panel">
        <h2>分组方式</h2>
        <Segmented
          label="分组方式"
          value={settings.groupBy}
          options={[
            { value: "size", label: "自定义每组词数" },
            { value: "deck", label: "按牌组单元" },
          ]}
          onChange={(groupBy) => props.onSettings({ groupBy })}
        />
        {settings.groupBy === "size" ? (
          <div className="size-row">
            <label>
              每组
              <input
                type="number"
                inputMode="numeric"
                min={GROUP_SIZE_MIN}
                max={GROUP_SIZE_MAX}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitSize}
                onKeyDown={(e) => e.key === "Enter" && commitSize()}
              />
              词
            </label>
            <input
              type="range"
              aria-label="每组词数"
              min={GROUP_SIZE_MIN}
              max={GROUP_SIZE_MAX}
              step={5}
              value={settings.groupSize}
              onChange={(e) => {
                setDraft(e.target.value);
                props.onSettings({ groupSize: Number(e.target.value) });
              }}
            />
            <span className="muted">10–200，共 {groups.length} 组。改词数不影响学习进度。</span>
          </div>
        ) : (
          <p className="muted">使用牌组自带的分类，共 {groups.length} 个单元。</p>
        )}
      </section>

      <ul className="group-list">
        {groups.map((group) => {
          const done = group.notes.filter((n) => !isUnseen(n.id, progress)).length;
          const unseen = group.notes.filter((n) => isUnseen(n.id, progress));
          const due = group.notes.filter((n) => isDue(n.id, progress));
          const percent = Math.round((done / group.notes.length) * 100);
          return (
            <li key={group.key}>
              <div className="group-head">
                <b>{group.title}</b>
                <span>{done} / {group.notes.length} 词</span>
              </div>
              <div className="goal" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${group.title}进度`}>
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="group-actions">
                <button className="solid small" disabled={!unseen.length} onClick={() => props.onStudy(group.title, unseen.map((n) => n.id))}>
                  {unseen.length ? `背 ${unseen.length} 词` : "已背完"}
                </button>
                <button className="ghost small" disabled={!due.length} onClick={() => props.onStudy(`${group.title}复习`, due.map((n) => n.id))}>
                  复习 {due.length}
                </button>
                <button className="ghost small" onClick={() => props.onQuiz(group)}>测验</button>
                <button className="ghost small" onClick={() => props.onBrowse(group)}>词表</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export type WordFilter = "all" | "studied" | Status | "starred" | "leech";

const FILTERS: { value: WordFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "studied", label: "已背过" },
  { value: "new", label: "未学" },
  { value: "learning", label: "学习中" },
  { value: "mastered", label: "已掌握" },
  { value: "familiar", label: "已熟悉" },
  { value: "starred", label: "生词本" },
  { value: "leech", label: "易错词" },
];

const matches = (id: string, filter: WordFilter, p: Progress) => {
  const status = statusOf(id, p);
  if (filter === "all") return true;
  if (filter === "studied") return !!p.cards[id];
  if (filter === "starred") return !!p.starred[id];
  if (filter === "leech") return (p.cards[id]?.lapses ?? 0) >= LEECH_LAPSES;
  return status === filter;
};

const STUDY_PAGE = 60;

export function WordsPage(props: {
  notes: Note[];
  groups: Group[];
  progress: Progress;
  filter: WordFilter;
  groupKey: string;
  onFilter: (filter: WordFilter) => void;
  onGroup: (key: string) => void;
  onOpen: (id: string, list: string[]) => void;
  onStudy: (title: string, ids: string[]) => void;
  onStar: (id: string) => void;
  onUnfamiliar: (id: string) => void;
}) {
  const { notes, groups, progress, filter, groupKey } = props;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"book" | "kana" | "due">("book");
  const [limit, setLimit] = useState(STUDY_PAGE);

  const scope = groups.find((g) => g.key === groupKey)?.notes ?? notes;
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, scope.filter((n) => matches(n.id, f.value, progress)).length])),
    [scope, progress],
  );
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = scope.filter(
      (n) => matches(n.id, filter, progress) && (!q || n.word.includes(q) || n.reading.includes(q) || n.meaning.toLowerCase().includes(q)),
    );
    if (sort === "kana") return [...found].sort((a, b) => a.reading.localeCompare(b.reading, "ja"));
    if (sort === "due") {
      const due = (n: Note) => {
        const card = progress.cards[n.id];
        return card ? new Date(card.due).getTime() : Infinity;
      };
      return [...found].sort((a, b) => due(a) - due(b));
    }
    return found;
  }, [scope, filter, progress, query, sort]);
  const ids = list.map((n) => n.id);

  return (
    <>
      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={filter === f.value ? "active" : ""}
            onClick={() => {
              props.onFilter(f.value);
              setLimit(STUDY_PAGE);
            }}
          >
            {f.label} <small>{counts[f.value]}</small>
          </button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="搜索单词、假名或中文" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={groupKey} onChange={(e) => props.onGroup(e.target.value)} aria-label="分组">
          <option value="">全部分组</option>
          {groups.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="排序">
          <option value="book">书本顺序</option>
          <option value="kana">五十音</option>
          <option value="due">复习时间</option>
        </select>
      </div>
      {(filter === "starred" || filter === "leech") && list.length > 0 && (
        <button className="ghost list-study" onClick={() => props.onStudy(FILTERS.find((f) => f.value === filter)!.label, ids)}>
          把这 {list.length} 个词背一遍
        </button>
      )}

      <ul className="word-grid">
        {list.slice(0, limit).map((n) => {
          const status = statusOf(n.id, progress);
          return (
            <li key={n.id}>
              <button className="word-open" onClick={() => props.onOpen(n.id, ids)}>
                <span className={`dot ${status}`} title={STATUS_LABEL[status]} />
                <b>{n.word}</b>
                <small>{n.reading} · {STATUS_LABEL[status]}</small>
                <span className="gloss">{n.meaning}</span>
              </button>
              <div className="word-tools">
                <button
                  className={progress.starred[n.id] ? "starred" : ""}
                  aria-pressed={!!progress.starred[n.id]}
                  aria-label={`${n.word}加入生词本`}
                  onClick={() => props.onStar(n.id)}
                >
                  {progress.starred[n.id] ? "★" : "☆"}
                </button>
                {status === "familiar" && <button onClick={() => props.onUnfamiliar(n.id)}>取消熟悉</button>}
              </div>
            </li>
          );
        })}
      </ul>
      {!list.length && <p className="empty">这里还没有单词</p>}
      {list.length > limit && (
        <button className="ghost more" onClick={() => setLimit(limit + STUDY_PAGE)}>再显示 {STUDY_PAGE} 个</button>
      )}
    </>
  );
}

function Bars(props: { label: string; bars: { key: string; value: number; tip: string; caption?: string }[] }) {
  const max = Math.max(1, ...props.bars.map((b) => b.value));
  return (
    <div className="bars" role="img" aria-label={props.label}>
      {props.bars.map((b) => (
        <div key={b.key} className="bar" data-tip={b.tip} tabIndex={0}>
          <i style={{ height: `${(b.value / max) * 100}%` }} className={b.value ? "" : "zero"} />
          {b.caption && <small>{b.caption}</small>}
        </div>
      ))}
    </div>
  );
}

const shortDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

export function StatsPage(props: { notes: Note[]; progress: Progress }) {
  const { notes, progress } = props;
  const days = recentDays(progress, 30);
  const coming = forecast(notes, progress, 7);
  const totals = Object.values(progress.log).reduce(
    (sum, d) => ({ review: sum.review + d.review, again: sum.again + d.again, new: sum.new + d.new }),
    { review: 0, again: 0, new: 0 },
  );
  const retention = totals.review ? Math.round((1 - totals.again / totals.review) * 100) : null;

  return (
    <>
      <section className="overview">
        <div><b>{streak(progress)}</b><span>连续打卡（天）</span></div>
        <div><b>{Object.keys(progress.log).length}</b><span>累计学习（天）</span></div>
        <div><b>{Object.keys(progress.cards).length.toLocaleString()}</b><span>已背过的词</span></div>
        <div><b>{retention === null ? "—" : `${retention}%`}</b><span>复习记住率</span></div>
      </section>
      <section className="panel">
        <h2>近 30 天背词量</h2>
        <Bars
          label="近 30 天每天背词量"
          bars={days.map((d, i) => ({
            key: d.date.toISOString(),
            value: d.new + d.review,
            tip: `${shortDate(d.date)}：新词 ${d.new}，复习 ${d.review}`,
            caption: i % 7 === 2 ? shortDate(d.date) : undefined,
          }))}
        />
      </section>
      <section className="panel">
        <h2>未来 7 天复习量</h2>
        <Bars
          label="未来 7 天每天到期词数"
          bars={coming.map((d) => ({
            key: d.date.toISOString(),
            value: d.due,
            tip: `${shortDate(d.date)}：${d.due} 词`,
            caption: shortDate(d.date),
          }))}
        />
      </section>
    </>
  );
}

export interface CloudControls {
  connected: boolean;
  label: string;
  error?: string;
  onConnect: (token: string) => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
}

function CloudSection({ cloud }: { cloud: CloudControls }) {
  const [token, setToken] = useState("");
  return (
    <section className="cloud">
      <h3>云同步</h3>
      {cloud.connected ? (
        <>
          <p className="muted">{cloud.label}。进度保存到你的私有仓库。</p>
          <div className="settings-actions">
            <button className="ghost" onClick={cloud.onSyncNow}>立即同步</button>
            <button className="ghost" onClick={cloud.onDisconnect}>断开这台设备</button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) cloud.onConnect(token.trim());
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴 GitHub 访问令牌"
            aria-label="GitHub 访问令牌"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="ghost" disabled={!token.trim()}>连接</button>
        </form>
      )}
      {cloud.error && <p className="error">{cloud.error}</p>}
    </section>
  );
}

export function SettingsPanel(props: {
  settings: Settings;
  progress: Progress;
  cloud: CloudControls;
  onChange: (patch: Partial<Settings>) => void;
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
      const parsed = JSON.parse(await file.text());
      if (!parsed.cards) throw new Error();
      if (confirm("恢复备份会覆盖当前进度，继续吗？")) props.onRestore(normalizeProgress(parsed));
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
            onChange={(e) => onChange({ dailyNew: Number(e.target.value) })} />
        </label>
        <label>新词顺序
          <select value={settings.newOrder} onChange={(e) => onChange({ newOrder: e.target.value as Settings["newOrder"] })}>
            <option value="book">书本顺序</option>
            <option value="random">随机</option>
          </select>
        </label>
        <label>目标记忆率
          <select value={settings.retention} onChange={(e) => onChange({ retention: Number(e.target.value) })}>
            {[0.85, 0.9, 0.95].map((r) => <option key={r} value={r}>{Math.round(r * 100)}%</option>)}
          </select>
        </label>
        <label>自动播放发音
          <input type="checkbox" checked={settings.autoplay}
            onChange={(e) => onChange({ autoplay: e.target.checked })} />
        </label>
        <CloudSection cloud={props.cloud} />
        <p className="muted shortcut">快捷键：R 发音，空格 看答案，1–4 评分，F 已熟悉，S 生词本，Z 撤销，← → 翻词</p>
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
