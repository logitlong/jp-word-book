import { PERSONAL } from "./lib/edition";
import { useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import type { QuizMode } from "./Quiz";
import { grammarScore, savedStep, stepCount, unitProgress, type GrammarBook } from "./lib/grammar";
import { lessonScore, loadTraps, readingScore, TRAP_ORDER, type PassageType, type ReadingBook } from "./lib/reading";
import {
  buildQueue,
  dayKey,
  forecast,
  GROUP_SIZE_MAX,
  GROUP_SIZE_MIN,
  isDue,
  isUnseen,
  learnedOn,
  LEECH_LAPSES,
  LEVELS,
  normalizeProgress,
  recentDays,
  STATUS_LABEL,
  statusOf,
  streak,
  type Group,
  type Level,
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

/** Quiz results recorded today for one section (`g:` grammar, `r:` reading). */
const answeredToday = (p: Progress, prefix: string) => {
  const today = dayKey();
  return Object.entries(p.quiz).filter(([id, r]) => id.startsWith(prefix) && dayKey(new Date(r.at)) === today).length;
};

function Meter({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="goal" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

export function TodayPage(props: {
  notes: Note[];
  groups: Group[];
  progress: Progress;
  settings: Settings;
  grammar: GrammarBook | null;
  reading: ReadingBook | null;
  onStudy: (title: string, ids: string[]) => void;
  onLevel: (level: Level) => void;
  onGrammar: (cat?: string) => void;
  onReading: (start?: "lesson" | PassageType) => void;
}) {
  const { notes, groups, progress, settings, grammar, reading } = props;
  const queue = buildQueue(notes, progress, settings);
  const log = progress.log[dayKey()];
  const learnedToday = learnedOn(notes, progress);
  const group = currentGroup(groups, progress);
  const ids = [...queue.due, ...queue.fresh].map((n) => n.id);
  const groupLeft = group?.notes.filter((n) => isUnseen(n.id, progress)) ?? [];
  const firstNew = queue.fresh[0];
  const firstGroup = firstNew && groups.find((g) => g.notes.includes(firstNew));
  const now = new Date();

  return (
    <>
      <section className="today-head">
        <p className="muted">{now.getMonth() + 1} 月 {now.getDate()} 日 · 连续打卡 {streak(progress)} 天</p>
        <div className="today-stats">
          <div><b>{(log?.new ?? 0) + (log?.review ?? 0)}</b><span>今日背词</span></div>
          <div><b>{queue.due.length}</b><span>待复习</span></div>
          {PERSONAL ? (
            <>
              <div><b>{answeredToday(progress, "g:")}</b><span>今日文法题</span></div>
              <div><b>{answeredToday(progress, "r:")}</b><span>今日读解题</span></div>
            </>
          ) : (
            <>
              <div><b>{queue.fresh.length}</b><span>今日新词</span></div>
              <div><b>{streak(progress)}</b><span>连续打卡（天）</span></div>
            </>
          )}
        </div>
      </section>

      <div className={PERSONAL ? "plan" : ""}>
        <section className="today plan-card">
          <div className="plan-title">
            <span className="plan-tag">单词</span>
            <Segmented label="级别" value={settings.level} options={LEVELS.map((value) => ({ value, label: value }))} onChange={props.onLevel} />
          </div>
          <p className="plan-big"><b>{ids.length}</b> 个待学{queue.due.length ? ` · 其中复习 ${queue.due.length}` : ""}</p>
          <Meter value={learnedToday / Math.max(1, settings.dailyNew)} label="今日新词目标" />
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
          <ul className="today-notes">
            {ids.length > 0 && (
              <li>
                先复习到期的 {queue.due.length} 词，再{settings.newOrder === "book" ? "按书本顺序" : "随机"}学 {queue.fresh.length} 个新词
                {firstNew && settings.newOrder === "book" ? `，从${firstGroup?.title ?? ""}的「${firstNew.word}」开始` : ""}。
              </li>
            )}
            {group && <li>继续{group.title}：把这个单元没背过的 {groupLeft.length} 词背完，不受每日新词数限制。</li>}
          </ul>
        </section>

        {PERSONAL && <GrammarPlan book={grammar} progress={progress} onOpen={props.onGrammar} />}
        {PERSONAL && <ReadingPlan book={reading} progress={progress} onOpen={props.onReading} />}
      </div>
    </>
  );
}

function GrammarPlan({ book, progress, onOpen }: { book: GrammarBook | null; progress: Progress; onOpen: (cat?: string) => void }) {
  if (!book) return <section className="today plan-card"><span className="plan-tag">文法</span><p className="muted">正在加载…</p></section>;
  const ready = book.categories.filter((c) => book.data[c.id]);
  // The first category not yet mastered, or the last one when all are.
  const current = ready.find((c) => unitProgress(c.id, book.data[c.id], progress.quiz) < 0.9) ?? ready[ready.length - 1];
  const unit = current && book.data[current.id];
  const score = grammarScore(book, progress.quiz);
  const step = current ? Math.min(savedStep(current.id), stepCount(unit) - 1) : 0;
  return (
    <section className="today plan-card">
      <div className="plan-title"><span className="plan-tag">文法</span><span className="muted">已导入 {ready.length} / {book.categories.length} 类</span></div>
      {current ? (
        <>
          <p className="plan-big"><span className="ja">{current.no}. {current.name}</span>{" "}<small className="muted">{current.zh}</small></p>
          <Meter value={(step + 1) / stepCount(unit)} label="本类学习进度" />
          <p className="goal-text">第 {step + 1} / {stepCount(unit)} 步 · 掌握 {Math.round(unitProgress(current.id, unit, progress.quiz) * 100)}%</p>
          <div className="today-actions">
            <button className="solid" onClick={() => onOpen(current.id)}>{step > 0 ? "继续学" : "开始学"}{current.name}</button>
            {score.wrong > 0 && <button className="ghost" onClick={() => onOpen()}>错题 {score.wrong}</button>}
          </div>
        </>
      ) : (
        <p className="muted">还没有导入文法。</p>
      )}
    </section>
  );
}

function ReadingPlan({ book, progress, onOpen }: { book: ReadingBook | null; progress: Progress; onOpen: (start?: "lesson" | PassageType) => void }) {
  if (!book) return <section className="today plan-card"><span className="plan-tag">读解</span><p className="muted">正在加载…</p></section>;
  const lesson = lessonScore(book, progress.quiz);
  const score = readingScore(book, progress.quiz);
  const nextType = book.lesson.types.find((t) => {
    const s = readingScore(book, progress.quiz, t.id);
    return s.done < s.total;
  });
  const traps = loadTraps();
  const top = TRAP_ORDER.map((t) => ({ t, n: Object.values(traps).filter((x) => x === t).length })).sort((a, b) => b.n - a.n)[0];
  const learnFirst = lesson.done < lesson.total;
  return (
    <section className="today plan-card">
      <div className="plan-title"><span className="plan-tag">读解</span><span className="muted">练习 {score.done} / {score.total} 题</span></div>
      {learnFirst ? (
        <>
          <p className="plan-big">先学技巧课</p>
          <Meter value={lesson.done / lesson.total} label="技巧课进度" />
          <p className="goal-text">关系判断和例题 {lesson.done} / {lesson.total}</p>
        </>
      ) : nextType ? (
        <>
          <p className="plan-big"><span className="ja">問題{nextType.no}</span> {nextType.zh}</p>
          <Meter value={score.done / score.total} label="读解练习进度" />
          <p className="goal-text">答对 {score.ok} / {score.done}{top?.n ? ` · 最常上当：${book.lesson.traps[top.t].name}（${top.n}）` : ""}</p>
        </>
      ) : (
        <>
          <p className="plan-big">练习都做过了</p>
          <p className="goal-text">答对 {score.ok} / {score.total}{score.wrong ? `，还有 ${score.wrong} 题错题可以重做` : ""}</p>
        </>
      )}
      <div className="today-actions">
        <button className="solid" onClick={() => onOpen(learnFirst ? "lesson" : nextType?.id)}>
          {learnFirst ? (lesson.done ? "继续技巧课" : "开始技巧课") : nextType ? `练習 問題${nextType.no}` : "去读解"}
        </button>
      </div>
    </section>
  );
}

export function GroupsPage(props: {
  groups: Group[];
  progress: Progress;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onStudy: (title: string, ids: string[]) => void;
  onQuiz: (group: Group, mode: QuizMode) => void;
  onBrowse: (group: Group) => void;
  onSprint: (title: string, notes: Note[]) => void;
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

      <section className="panel">
        <h2>学习方式</h2>
        <Segmented label="学习方式" value={settings.mode} options={MODES} onChange={(mode) => props.onSettings({ mode })} />
        <p className="muted">{MODES.find((m) => m.value === settings.mode)?.hint}</p>
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
                {settings.level !== "N1 真题" && <button className="ghost small" onClick={() => props.onQuiz(group, "exam")}>真题测验</button>}
                <button className="ghost small" onClick={() => props.onQuiz(group, "words")}>单词测验</button>
                <button className="ghost small" onClick={() => props.onBrowse(group)}>词表</button>
                <button className="ghost small" onClick={() => props.onSprint(group.title, group.notes)}>速刷</button>
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
  onSprint: (title: string, notes: Note[]) => void;
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
        <button className="ghost" disabled={!list.length} onClick={() => props.onSprint("速刷", list)}>速刷 {list.length}</button>
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

export function StatsPage(props: { notes: Note[]; progress: Progress; grammar: GrammarBook | null; reading: ReadingBook | null }) {
  const { notes, progress, grammar, reading } = props;
  const days = recentDays(progress, 30);
  const coming = forecast(notes, progress, 7);
  const totals = Object.values(progress.log).reduce(
    (sum, d) => ({ review: sum.review + d.review, again: sum.again + d.again, new: sum.new + d.new }),
    { review: 0, again: 0, new: 0 },
  );
  const retention = totals.review ? Math.round((1 - totals.again / totals.review) * 100) : null;
  const pct = (ok: number, done: number) => (done ? `${Math.round((ok / done) * 100)}%` : "—");

  // Questions are counted on the day of their latest answer.
  const questionDays = days.map((d) => {
    const key = dayKey(d.date);
    let g = 0, r = 0;
    for (const [id, res] of Object.entries(progress.quiz)) {
      if (dayKey(new Date(res.at)) !== key) continue;
      if (id.startsWith("g:")) g++;
      else if (id.startsWith("r:")) r++;
    }
    return { date: d.date, g, r };
  });
  const gScore = grammar && grammarScore(grammar, progress.quiz);
  const rScore = reading && readingScore(reading, progress.quiz);
  const traps = loadTraps();
  const trapCount = TRAP_ORDER.map((t) => ({ t, n: Object.values(traps).filter((x) => x === t).length }));
  const maxTrap = Math.max(1, ...trapCount.map((x) => x.n));

  return (
    <>
      <section className="overview">
        <div><b>{streak(progress)}</b><span>连续打卡（天）</span></div>
        <div><b>{Object.keys(progress.log).length}</b><span>累计学习（天）</span></div>
        {PERSONAL ? (
          <>
            <div><b>{gScore ? pct(gScore.ok, gScore.done) : "—"}</b><span>文法题正确率</span></div>
            <div><b>{rScore ? pct(rScore.ok, rScore.done) : "—"}</b><span>读解题正确率</span></div>
          </>
        ) : (
          <>
            <div><b>{notes.filter((n) => progress.cards[n.id]).length.toLocaleString()}</b><span>已背过的词</span></div>
            <div><b>{retention === null ? "—" : `${retention}%`}</b><span>复习记住率</span></div>
          </>
        )}
      </section>

      {PERSONAL && <h2 className="stats-h">单词</h2>}
      <section className="overview">
        {(["new", "learning", "mastered", "familiar"] as Status[]).map((s) => (
          <div key={s}><b>{countOf(notes, progress, s).toLocaleString()}</b><span>{STATUS_LABEL[s]}</span></div>
        ))}
      </section>
      {PERSONAL && <p className="muted stats-note">复习记住率 {retention === null ? "—" : `${retention}%`}</p>}
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

      {PERSONAL && (
        <>
          <h2 className="stats-h">文法 · 读解</h2>
          <section className="panel">
            <h2>近 30 天答题量</h2>
            <Bars
              label="近 30 天每天文法和读解答题数"
              bars={questionDays.map((d, i) => ({
                key: d.date.toISOString(),
                value: d.g + d.r,
                tip: `${shortDate(d.date)}：文法 ${d.g}，读解 ${d.r}`,
                caption: i % 7 === 2 ? shortDate(d.date) : undefined,
              }))}
            />
            <p className="muted">同一道题只按最近一次作答的日期算。</p>
          </section>
          <div className="stats-split">
            <section className="panel">
              <h2>文法掌握度</h2>
              {grammar ? (
                <>
                  <p className="muted stats-sub">书上的题做了 {gScore!.done} / {gScore!.total}，答对 {gScore!.ok}</p>
                  {grammar.categories.map((c) => {
                    const unit = grammar.data[c.id];
                    const p = unit ? unitProgress(c.id, unit, progress.quiz) : 0;
                    return (
                      <div key={c.id} className={`stat-row${unit ? "" : " off"}`}>
                        <span className="ja">{c.no}. {c.name}</span>
                        <span className="g-bar"><i style={{ width: `${p * 100}%` }} /></span>
                        <span className="muted">{unit ? `${Math.round(p * 100)}%` : "—"}</span>
                      </div>
                    );
                  })}
                </>
              ) : <p className="muted">正在加载…</p>}
            </section>
            <section className="panel">
              <h2>读解正确率</h2>
              {reading ? (
                <>
                  <p className="muted stats-sub">练习做了 {rScore!.done} / {rScore!.total}，答对 {rScore!.ok}</p>
                  {reading.lesson.types.map((t) => {
                    const s = readingScore(reading, progress.quiz, t.id);
                    return (
                      <div key={t.id} className="stat-row">
                        <span>問題{t.no} {t.zh}</span>
                        <span className="g-bar"><i style={{ width: `${s.total ? (s.ok / s.total) * 100 : 0}%` }} /></span>
                        <span className="muted">{s.ok}/{s.total}</span>
                      </div>
                    );
                  })}
                  <h2 className="stats-inner-h">最容易上当的错误选项</h2>
                  {trapCount.map(({ t, n }) => (
                    <div key={t} className="stat-row">
                      <span><span className={`r-trap ${t}`}>{reading.lesson.traps[t].name}</span></span>
                      <span className="g-bar"><i className="warn" style={{ width: `${(n / maxTrap) * 100}%` }} /></span>
                      <span className="muted">{n}</span>
                    </div>
                  ))}
                </>
              ) : <p className="muted">正在加载…</p>}
            </section>
          </div>
        </>
      )}
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
  return (
    <section className="cloud">
      <h3>云同步</h3>
      <p className="muted">{cloud.label}。进度保存到你的私有仓库。</p>
      <div className="settings-actions">
        <button className="ghost" onClick={cloud.onSyncNow}>立即同步</button>
        <button className="ghost" onClick={cloud.onDisconnect}>断开这台设备</button>
      </div>
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
  onResetProgress: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { settings, onChange } = props;
  const exportProgress = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(props.progress)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `合格線进度-${dayKey()}.json`;
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
        {PERSONAL ? (
          <CloudSection cloud={props.cloud} />
        ) : (
          <p className="muted local-note">学习进度保存在这台设备的浏览器里。换设备或清理浏览器数据前，请先导出进度，到新设备上恢复。</p>
        )}
        <p className="muted shortcut">
          快捷键：空格 翻面，翻面后再按一次算认识；D 不认识；R 发音；F 已熟悉；S 生词本；Z 撤销；← → 翻词；Esc 关闭
        </p>
        <div className="settings-actions">
          <button className="ghost" onClick={exportProgress}>导出进度</button>
          <label className="ghost file">恢复进度
            <input type="file" accept=".json" onChange={(e) => void restore(e.target.files?.[0])} />
          </label>
          <button className="ghost danger" onClick={props.onResetProgress}>重置学习进度</button>
          <button className="ghost danger" onClick={props.onReset}>清空牌组和进度</button>
        </div>
        <button className="solid" onClick={props.onClose}>完成</button>
      </section>
    </div>
  );
}
