import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  drillId,
  exampleId,
  loadReading,
  readingId,
  type Passage,
  type PassageType,
  type ReadingBook,
  type ReadingLesson,
  type ReadingQuestion,
  type Trap,
} from "./lib/reading";
import type { QuizResult } from "./lib/sync";

type Results = Record<string, QuizResult>;
type Answer = (id: string, ok: boolean) => void;

const TRAP_KEY = "reading-traps";
const TRAP_ORDER: Trap[] = ["said", "missing", "reversed", "offtopic", "circular"];

/** The trap behind each wrong pick, kept on this device to show which mistakes repeat. */
function loadTraps(): Record<string, Trap> {
  try {
    return JSON.parse(localStorage.getItem(TRAP_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveTrap(id: string, trap: Trap | null) {
  const all = loadTraps();
  if (trap) all[id] = trap;
  else delete all[id];
  try {
    localStorage.setItem(TRAP_KEY, JSON.stringify(all));
  } catch {
    /* Only the statistics miss this answer. */
  }
}

type View =
  | { kind: "map" }
  | { kind: "lesson"; i: number }
  | { kind: "practice"; type: PassageType | "wrong"; ids: string[]; i: number };

export function ReadingPage({ results, onAnswer }: { results: Results; onAnswer: Answer }) {
  const [book, setBook] = useState<ReadingBook | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ kind: "map" });
  const [traps, setTraps] = useState(loadTraps);

  const fetchBook = () => loadReading().then(setBook, (e: unknown) => setError(e instanceof Error ? e.message : "读解加载失败"));
  useEffect(() => void fetchBook(), []);

  const answer = (id: string, ok: boolean, trap: Trap | null) => {
    onAnswer(id, ok);
    saveTrap(id, ok ? null : trap);
    setTraps(loadTraps());
  };

  if (error) {
    return (
      <section className="panel g-panel">
        <p className="error">{error}</p>
        <button className="solid" onClick={() => { setError(""); void fetchBook(); }}>重试</button>
      </section>
    );
  }
  if (!book) return <p className="muted g-loading">正在加载读解…</p>;
  const { lesson, passages } = book;
  const toMap = () => { setView({ kind: "map" }); window.scrollTo(0, 0); };

  if (view.kind === "lesson") {
    return <LessonView lesson={lesson} i={view.i} results={results} onAnswer={answer} onStep={(i) => setView({ kind: "lesson", i })} onDone={toMap} />;
  }
  if (view.kind === "practice") {
    const p = passages.find((x) => x.id === view.ids[view.i])!;
    const type = lesson.types.find((t) => t.id === p.type)!;
    return (
      <section className="g-lesson r-wide">
        <div className="g-lesson-head">
          <button className="chip" onClick={toMap}>← 读解</button>
          <h2>{view.type === "wrong" ? "错题" : `問題${type.no} ${type.zh}`}</h2>
        </div>
        <div className="g-progress">
          {view.ids.map((id, k) => (
            <button key={id} className={k < view.i ? "on" : k === view.i ? "cur" : ""} aria-label={`第 ${k + 1} 篇`} onClick={() => setView({ ...view, i: k })} />
          ))}
        </div>
        <PassageView key={p.id + view.i} p={p} lesson={lesson} onAnswer={answer} />
        <div className="g-nav">
          <button className="ghost" disabled={view.i === 0} onClick={() => { setView({ ...view, i: view.i - 1 }); window.scrollTo(0, 0); }}>← 上一篇</button>
          <button
            className="solid"
            onClick={() => (view.i === view.ids.length - 1 ? toMap() : (setView({ ...view, i: view.i + 1 }), window.scrollTo(0, 0)))}
          >
            {view.i === view.ids.length - 1 ? "回到读解" : "下一篇 →"}
          </button>
        </div>
      </section>
    );
  }

  const lessonDone = lessonSteps(lesson).filter((s) => s.id && results[s.id]).length;
  const lessonTotal = lessonSteps(lesson).filter((s) => s.id).length;
  const wrongIds = passages.filter((p) => p.questions.some((_, k) => results[readingId(p.id, k)]?.ok === false)).map((p) => p.id);
  const trapCount = TRAP_ORDER.map((t) => ({ t, n: Object.values(traps).filter((x) => x === t).length }));
  const maxTrap = Math.max(1, ...trapCount.map((x) => x.n));

  return (
    <section className="g-map">
      <button className="panel r-lesson-card" onClick={() => setView({ kind: "lesson", i: 0 })}>
        <span className="r-badge">先学</span>
        <span>
          <b>读解技巧课</b>
          <span className="muted">三种关系 ＝ ↔ → · 解题三步 · 错误选项的 5 种类型 · 3 道例题 · 已练 {lessonDone}/{lessonTotal}</span>
        </span>
      </button>
      <div className="r-types">
        {lesson.types.map((t) => {
          const list = passages.filter((p) => p.type === t.id);
          const ids = list.flatMap((p) => p.questions.map((_, k) => readingId(p.id, k)));
          const done = ids.filter((id) => results[id]).length;
          const ok = ids.filter((id) => results[id]?.ok).length;
          return (
            <button key={t.id} className="panel r-type" onClick={() => setView({ kind: "practice", type: t.id, ids: list.map((p) => p.id), i: 0 })}>
              <span className="r-no">問題{t.no}</span>
              <b>{t.zh}</b>
              <span className="muted">{t.len} · 考试 {t.count} · 建议 {t.minutes} 分钟/篇</span>
              <span className="g-bar"><i style={{ width: `${ids.length ? (ok / ids.length) * 100 : 0}%` }} /></span>
              <span className="muted">练习 {list.length} 篇 · 答对 {ok}/{ids.length}{done > ok ? ` · 错 ${done - ok}` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="panel g-panel">
        <h2 className="g-h">我最容易上当的错误选项 <span className="muted">按做错时选的那个选项统计</span></h2>
        {trapCount.map(({ t, n }) => (
          <div key={t} className="r-trap-row">
            <span className={`r-trap ${t}`}>{lesson.traps[t].name}</span>
            <span className="g-bar"><i style={{ width: `${(n / maxTrap) * 100}%` }} /></span>
            <span className="muted">{n}</span>
          </div>
        ))}
        {wrongIds.length > 0 && (
          <button className="solid g-wrong" onClick={() => setView({ kind: "practice", type: "wrong", ids: wrongIds, i: 0 })}>重做有错题的文章（{wrongIds.length} 篇）</button>
        )}
      </div>
    </section>
  );
}

// ---------------- 技巧课 ----------------

type LessonStep = { name: string; id?: string; render: (ctx: { results: Results; onAnswer: (id: string, ok: boolean, trap: Trap | null) => void }) => ReactNode };

function lessonSteps(lesson: ReadingLesson): LessonStep[] {
  const r = lesson.relations;
  return [
    { name: "题型总览", render: () => <TypesOverview lesson={lesson} /> },
    { name: "三种关系", render: () => <Relations lesson={lesson} /> },
    ...r.drills.map((_, i): LessonStep => ({
      name: `关系判断 ${i + 1}/${r.drills.length}`,
      id: drillId(i),
      render: ({ onAnswer }) => <Drill key={i} lesson={lesson} i={i} onAnswer={(ok) => onAnswer(drillId(i), ok, null)} />,
    })),
    { name: "解题三步", render: () => <Steps lesson={lesson} /> },
    { name: "错误选项的类型", render: () => <Traps lesson={lesson} /> },
    ...lesson.examples.map((_, i): LessonStep => ({
      name: `例题 ${i + 1}/${lesson.examples.length}`,
      id: exampleId(i),
      render: ({ onAnswer }) => <Example key={i} lesson={lesson} i={i} onAnswer={onAnswer} />,
    })),
  ];
}

function LessonView(props: { lesson: ReadingLesson; i: number; results: Results; onAnswer: (id: string, ok: boolean, trap: Trap | null) => void; onStep: (i: number) => void; onDone: () => void }) {
  const steps = lessonSteps(props.lesson);
  const step = steps[props.i];
  const last = props.i === steps.length - 1;
  const go = (i: number) => {
    props.onStep(Math.max(0, Math.min(steps.length - 1, i)));
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
      if (e.key === "ArrowRight") go(props.i + 1);
      if (e.key === "ArrowLeft") go(props.i - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  return (
    <section className="g-lesson">
      <div className="g-lesson-head">
        <button className="chip" onClick={props.onDone}>← 读解</button>
        <h2>读解技巧课</h2>
      </div>
      <div className="g-progress">
        {steps.map((s, k) => (
          <button key={k} className={k < props.i ? "on" : k === props.i ? "cur" : ""} title={s.name} aria-label={s.name} onClick={() => go(k)} />
        ))}
      </div>
      <p className="muted g-stepname">{step.name}</p>
      {step.render({ results: props.results, onAnswer: props.onAnswer })}
      <div className="g-nav">
        <button className="ghost" disabled={props.i === 0} onClick={() => go(props.i - 1)}>← 上一步</button>
        <button className="solid" onClick={() => (last ? props.onDone() : go(props.i + 1))}>{last ? "开始练习" : "下一步 →"}</button>
      </div>
    </section>
  );
}

function TypesOverview({ lesson }: { lesson: ReadingLesson }) {
  return (
    <div className="panel g-panel">
      <h2 className="g-h">N1 读解有 6 种题型</h2>
      <div className="r-table">
        {lesson.types.map((t) => (
          <div key={t.id} className="r-table-row">
            <span className="r-no">問題{t.no}</span>
            <span><b className="ja">{t.name}</b><span className="muted">{t.len} · {t.count}</span></span>
            <span className="r-tip">{t.tip}</span>
          </div>
        ))}
      </div>
      <p className="muted">题量可能会有变动。每种题型的「建议时间」是我按 110 分钟（含文字词汇语法）估的分配，不是书上的。</p>
    </div>
  );
}

function Relations({ lesson }: { lesson: ReadingLesson }) {
  const r = lesson.relations;
  return (
    <div className="panel g-panel">
      <h2 className="g-h">读解最重要的一件事</h2>
      <p>{r.intro}</p>
      <div className="r-kinds">
        {r.kinds.map((k) => (
          <div key={k.id} className={`r-kind ${k.id}`}>
            <b>{k.sym}</b>
            <span className="ja">{k.name}</span>
            <span className="muted">{k.zh}</span>
          </div>
        ))}
      </div>
      <p className="muted">在三个层面找关系：单词和单词、句子和句子、段落和段落。{r.note}</p>
    </div>
  );
}

/** Renders `【…】` pairs as the A and B of a relation. */
function AB({ text }: { text: string }) {
  let n = 0;
  return (
    <>
      {text.split(/【(.+?)】/).map((part, k) => {
        if (k % 2 === 0) return <Fragment key={k}>{part}</Fragment>;
        const label = n++ === 0 ? "A" : "B";
        return <mark key={k} className={`r-ab ${label}`}><sup>{label}</sup>{part}</mark>;
      })}
    </>
  );
}

function Drill({ lesson, i, onAnswer }: { lesson: ReadingLesson; i: number; onAnswer: (ok: boolean) => void }) {
  const d = lesson.relations.drills[i];
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string) => {
    if (picked) return;
    setPicked(id);
    onAnswer(id === d.ans);
  };
  return (
    <div className="panel g-panel">
      <h2 className="g-h">A 和 B 是什么关系？ <span className="muted">{d.level}</span></h2>
      <p className="g-q ja"><AB text={d.text} /></p>
      <div className="r-kinds pick">
        {lesson.relations.kinds.map((k) => (
          <button
            key={k.id}
            className={`r-kind ${k.id}${picked && k.id === d.ans ? " ok" : ""}${picked === k.id && k.id !== d.ans ? " ng" : ""}`}
            disabled={!!picked}
            onClick={() => pick(k.id)}
          >
            <b>{k.sym}</b>
            <span className="ja">{k.name}</span>
          </button>
        ))}
      </div>
      {picked && <div className={`g-fb ${picked === d.ans ? "ok" : "ng"}`}><p>{picked === d.ans ? "✓ 对了　" : "✗ "}{d.why}</p></div>}
    </div>
  );
}

function Steps({ lesson }: { lesson: ReadingLesson }) {
  return (
    <div className="panel g-panel">
      <h2 className="g-h">解题三步</h2>
      <div className="r-steps">
        {lesson.steps.map((s) => (
          <div key={s.no} className="r-step">
            <span className="r-step-no">{s.no}</span>
            <span><b>{s.title}</b><span className="muted">{s.desc}</span></span>
          </div>
        ))}
      </div>
      <p className="muted">第 ③ 步最关键：4 个选项里只有 1 个能在原文里找到完全对应的内容。把每个选项拆开，逐块回原文核对，有一块对不上就排除。</p>
    </div>
  );
}

function Traps({ lesson }: { lesson: ReadingLesson }) {
  return (
    <>
      <div className="panel g-panel">
        <h2 className="g-h">错误选项的 5 种类型</h2>
        {TRAP_ORDER.map((t) => (
          <div key={t} className="r-trap-def">
            <span className={`r-trap ${t}`}>{lesson.traps[t].name}</span>
            <span><span className="ja muted">{lesson.traps[t].ja}</span>　{lesson.traps[t].desc}</span>
          </div>
        ))}
        <p className="muted">前四种是书里讲的；「答非所问」是我加的，长文题里很常见。</p>
      </div>
      <div className="panel g-panel">
        <h2 className="g-h">书里的例子</h2>
        {lesson.trapExamples.map((ex, k) => (
          <div key={k} className="r-trap-ex">
            <span className={`r-trap ${ex.trap}`}>{lesson.traps[ex.trap].name}</span>
            <p className="ja">本文：{ex.text}</p>
            <p className="ja">問題：{ex.q}</p>
            <p className="ja r-strike">選択肢：{ex.opt}</p>
            <p className="muted">{ex.why}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function Example({ lesson, i, onAnswer }: { lesson: ReadingLesson; i: number; onAnswer: (id: string, ok: boolean, trap: Trap | null) => void }) {
  const ex = lesson.examples[i];
  const [done, setDone] = useState(false);
  return (
    <>
      <div className="panel g-panel">
        <h2 className="g-h">本文</h2>
        <p className="r-text ja">{ex.text}</p>
        {done && <p className="r-summary">本文をまとめると：<span className="ja">{ex.summary}</span></p>}
      </div>
      <QuestionBlock q={ex.q} n={0} lesson={lesson} onAnswer={(ok, trap) => { onAnswer(exampleId(i), ok, trap); setDone(true); }} />
    </>
  );
}

// ---------------- 练习 ----------------

function useTimer(running: boolean) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return Math.floor((now - start) / 1000);
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function PassageView({ p, lesson, onAnswer }: { p: Passage; lesson: ReadingLesson; onAnswer: (id: string, ok: boolean, trap: Trap | null) => void }) {
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  const [showNotes, setShowNotes] = useState(false);
  const all = answered.size === p.questions.length;
  const seconds = useTimer(!all);
  const type = lesson.types.find((t) => t.id === p.type)!;
  const target = type.minutes * 60;
  const evidence = p.questions.flatMap((q, k) => (answered.has(k) ? q.evidence : []));

  return (
    <>
      <div className="r-head">
        <span className="ja"><b>{p.title}</b></span>
        <span className={`r-timer${seconds > target ? " over" : ""}`}>⏱ {clock(seconds)} / 建议 {type.minutes}:00</span>
      </div>
      <p className="muted r-tipline">{type.tip}</p>
      <div className="r-split">
        <div className="panel r-passage">
          {typeof p.text === "string" ? (
            <PassageText text={p.text} evidence={evidence} info={p.type === "info"} />
          ) : (
            Object.entries(p.text).map(([side, text]) => (
              <div key={side} className="r-side">
                <span className="r-side-label">{side}</span>
                <PassageText text={text} evidence={evidence} />
              </div>
            ))
          )}
          {p.notes.length > 0 && (
            <div className="r-notes">
              <button className="g-link" onClick={() => setShowNotes(!showNotes)}>{showNotes ? "收起注释" : `注释（${p.notes.length}）`}</button>
              {showNotes && <dl>{p.notes.map((n) => <Fragment key={n.term}><dt className="ja">{n.term}</dt><dd className="ja">{n.def}</dd></Fragment>)}</dl>}
            </div>
          )}
          {p.source && <p className="muted r-source ja">（{p.source}による）</p>}
        </div>
        <div className="r-questions">
          {p.questions.map((q, k) => (
            <QuestionBlock
              key={k}
              q={q}
              n={p.questions.length > 1 ? k + 1 : 0}
              lesson={lesson}
              onAnswer={(ok, trap) => {
                onAnswer(readingId(p.id, k), ok, trap);
                setAnswered((s) => new Set(s).add(k));
              }}
            />
          ))}
          {all && (
            <div className="panel g-panel r-gist">
              <h2 className="g-h">全文主旨 <span className="muted">用时 {clock(seconds)}</span></h2>
              <p>{p.gist}</p>
              <p className="muted">原文里高亮的是每道题的依据句。</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Splits text into runs that carry an underline number and an evidence highlight. */
function PassageText({ text, evidence, info }: { text: string; evidence: string[]; info?: boolean }) {
  const chars: { ch: string; under: string; hl: boolean }[] = [];
  const re = /【([①②③④])(.+?)】/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    for (const ch of text.slice(last, m.index)) chars.push({ ch, under: "", hl: false });
    for (const ch of m[2]) chars.push({ ch, under: m[1], hl: false });
    last = m.index! + m[0].length;
  }
  for (const ch of text.slice(last)) chars.push({ ch, under: "", hl: false });
  // Evidence may run across a paragraph break, so it is matched with breaks left out.
  const flatIndex = chars.flatMap((c, k) => (c.ch === "\n" ? [] : [k]));
  const flat = flatIndex.map((k) => chars[k].ch).join("");
  for (const e of evidence) {
    const at = flat.indexOf(e);
    if (at >= 0) for (let k = at; k < at + e.length; k++) chars[flatIndex[k]].hl = true;
  }
  const paragraphs: (typeof chars)[] = [[]];
  for (const c of chars) {
    if (c.ch === "\n") paragraphs.push([]);
    else paragraphs[paragraphs.length - 1].push(c);
  }
  return (
    <div className={`r-text ja${info ? " info" : ""}`}>
      {paragraphs.map((para, pi) => {
        const runs: { text: string; under: string; hl: boolean; first: boolean }[] = [];
        para.forEach((c, k) => {
          const prev = runs[runs.length - 1];
          if (prev && prev.under === c.under && prev.hl === c.hl) prev.text += c.ch;
          else runs.push({ text: c.ch, under: c.under, hl: c.hl, first: !!c.under && (k === 0 || para[k - 1].under !== c.under) });
        });
        return (
          <p key={pi}>
            {runs.map((r, k) => {
              const inner = r.hl ? <mark className="r-evidence">{r.text}</mark> : r.text;
              return r.under ? <span key={k} className="r-under">{r.first && <sup>{r.under}</sup>}{inner}</span> : <Fragment key={k}>{inner}</Fragment>;
            })}
          </p>
        );
      })}
    </div>
  );
}

/** Answer by elimination: cross options out first, then pick the one left. */
function QuestionBlock({ q, n, lesson, onAnswer }: { q: ReadingQuestion; n: number; lesson: ReadingLesson; onAnswer: (ok: boolean, trap: Trap | null) => void }) {
  const [crossed, setCrossed] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const toggle = (k: number) => {
    if (submitted) return;
    setCrossed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setPicked((p) => (p === k ? 0 : p));
  };
  const submit = () => {
    if (!picked || submitted) return;
    setSubmitted(true);
    onAnswer(picked === q.ans, q.options[picked - 1].trap);
  };
  const ok = picked === q.ans;

  return (
    <div className="panel g-panel r-q">
      <p className="g-q ja">{n > 0 && <span className="r-qno">{n}</span>}{q.stem}</p>
      {!submitted && <p className="muted">先点 ✗ 排除错的，再选剩下的那个。</p>}
      <div className="r-opts">
        {q.options.map((o, i) => {
          const k = i + 1;
          const cls = submitted ? (k === q.ans ? " ok" : k === picked ? " ng" : " dim") : crossed.has(k) ? " crossed" : picked === k ? " picked" : "";
          return (
            <div key={k} className={`r-opt${cls}`}>
              <button className="r-x" disabled={submitted} aria-label={crossed.has(k) ? "取消排除" : "排除"} onClick={() => toggle(k)}>✗</button>
              <button className="r-opt-text ja" disabled={submitted || crossed.has(k)} onClick={() => setPicked(k)}>
                <span className="g-k">{k}</span>{o.text}
              </button>
              {submitted && (
                <div className="r-why">
                  {o.trap ? <span className={`r-trap ${o.trap}`}>{lesson.traps[o.trap].name}</span> : <span className="r-trap right">正解</span>}
                  <span>{o.why}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!submitted ? (
        <button className="solid r-submit" disabled={!picked} onClick={submit}>确定</button>
      ) : (
        <div className={`g-fb ${ok ? "ok" : "ng"}`}>
          <p>{ok ? "✓ 正确" : `✗ 正确答案是 ${q.ans}`}{crossed.size > 0 && `　排除了 ${crossed.size} 个${[...crossed].includes(q.ans) ? "（把正解也排除了）" : ""}`}</p>
          {q.note && <p className="muted">{q.note}</p>}
        </div>
      )}
    </div>
  );
}
