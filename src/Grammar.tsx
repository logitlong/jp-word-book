import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { checkId, loadGrammar, mastery, quizId, savedStep, saveStep, sortId, unitProgress, type GrammarBook, type GrammarItem, type GrammarUnit } from "./lib/grammar";
import { shuffled } from "./lib/store";
import type { QuizResult } from "./lib/sync";

type Results = Record<string, QuizResult>;
type Answer = (id: string, ok: boolean) => void;

type Step =
  | { type: "intro"; name: string }
  | { type: "item"; name: string; id: string; idx: number }
  | { type: "compare"; name: string }
  | { type: "quiz"; name: string; cat: string; i: number }
  | { type: "sort"; name: string; cat: string; i: number }
  | { type: "summary"; name: string }
  | { type: "wrongdone"; name: string };

type View = { kind: "map" } | { kind: "lesson"; cat: string; steps: Step[]; i: number; title: string; wrong?: boolean };

/** Renders `【…】` as highlighted grammar, or as a blank to fill. */
function Marked({ text, blank }: { text: string; blank?: boolean }) {
  const parts = text.split(/【(.+?)】/);
  return (
    <>
      {parts.map((part, k) =>
        k % 2 ? <mark key={k} className="g-mark">{blank ? "（　　）" : part}</mark> : <Fragment key={k}>{part}</Fragment>,
      )}
    </>
  );
}

function buildSteps(cat: string, unit: GrammarUnit): Step[] {
  return [
    { type: "intro", name: "总览" },
    ...unit.items.map((it, idx): Step => ({ type: "item", id: it.id, idx, name: it.pattern })),
    { type: "compare", name: "易混辨析" },
    ...unit.quiz.map((_, i): Step => ({ type: "quiz", cat, i, name: `问题5 · ${i + 1}/${unit.quiz.length}` })),
    ...unit.sort.map((_, i): Step => ({ type: "sort", cat, i, name: `问题6 ★ · ${i + 1}/${unit.sort.length}` })),
    { type: "summary", name: "总结" },
  ];
}

function wrongSteps(book: GrammarBook, results: Results): Step[] {
  const list: Step[] = [];
  for (const [cat, unit] of Object.entries(book.data)) {
    unit.quiz.forEach((_, i) => results[quizId(cat, i)]?.ok === false && list.push({ type: "quiz", cat, i, name: "" }));
    unit.sort.forEach((_, i) => results[sortId(cat, i)]?.ok === false && list.push({ type: "sort", cat, i, name: "" }));
  }
  return list.map((s, k) => ({ ...s, name: `错题 ${k + 1}/${list.length}` }));
}

/** Number keys pick options while a question is open. */
function useNumberKeys(onKey: (n: number) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, textarea")) return;
      if (/^[1-4]$/.test(e.key)) onKey(Number(e.key));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
}

/** `start` opens a category straight away, where its lesson was left. */
export function GrammarPage({ results, onAnswer, start }: { results: Results; onAnswer: Answer; start?: string }) {
  const [book, setBook] = useState<GrammarBook | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ kind: "map" });
  const [opened, setOpened] = useState(false);

  const fetchBook = () => loadGrammar().then(setBook, (e: unknown) => setError(e instanceof Error ? e.message : "文法加载失败"));
  const load = () => {
    setError("");
    void fetchBook();
  };
  useEffect(() => void fetchBook(), []);

  const go = (i: number) => {
    if (view.kind !== "lesson") return;
    const next = Math.max(0, Math.min(view.steps.length - 1, i));
    if (!view.wrong) saveStep(view.cat, next);
    setView({ ...view, i: next });
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (view.kind !== "lesson") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
      if (e.key === "ArrowRight") go(view.i + 1);
      if (e.key === "ArrowLeft") go(view.i - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (error) {
    return (
      <section className="panel g-panel">
        <p className="error">{error}</p>
        <button className="solid" onClick={load}>重试</button>
      </section>
    );
  }
  if (!book) return <p className="muted g-loading">正在加载文法…</p>;

  const openLesson = (cat: string) => {
    const steps = buildSteps(cat, book.data[cat]);
    const title = book.categories.find((c) => c.id === cat)?.name ?? cat;
    setView({ kind: "lesson", cat, steps, i: Math.min(savedStep(cat), steps.length - 1), title });
  };
  if (start && !opened && book.data[start]) {
    setOpened(true);
    openLesson(start);
    return null;
  }
  const openWrong = () => {
    const steps = wrongSteps(book, results);
    if (!steps.length) return;
    const first = steps[0] as { cat: string };
    setView({ kind: "lesson", cat: first.cat, steps: [...steps, { type: "wrongdone", name: "完成" }], i: 0, title: "错题本", wrong: true });
  };
  const jumpTo = (cat: string, id: string) => {
    const steps = buildSteps(cat, book.data[cat]);
    const i = steps.findIndex((s) => s.type === "item" && s.id === id);
    saveStep(cat, i);
    setView({ kind: "lesson", cat, steps, i, title: book.categories.find((c) => c.id === cat)?.name ?? cat });
    window.scrollTo(0, 0);
  };

  if (view.kind === "map") {
    const wrong = wrongSteps(book, results).length;
    return (
      <section className="g-map">
        <div className="panel g-howto">
          <p>
            每一类按顺序走：总览 → 一个一个学文法（学完一个马上抽查学过的）→ 易混辨析 → 问题5 选择题 → 问题6 ★排序。做错的题进错题本，答题记录会和单词进度一起同步。
          </p>
          {wrong > 0 && <button className="solid" onClick={openWrong}>错题本 {wrong}</button>}
        </div>
        <div className="g-path">
          {book.categories.map((c) => {
            const unit = book.data[c.id];
            const p = unit ? unitProgress(c.id, unit, results) : 0;
            return (
              <button key={c.id} className={`g-node${unit ? "" : " locked"}${p >= 0.9 ? " done" : ""}`} disabled={!unit} onClick={() => openLesson(c.id)}>
                <span className="g-no" style={{ "--p": p } as CSSProperties}>{c.no}</span>
                <span className="g-node-text">
                  <b>{c.name}</b>
                  <span className="muted">{c.zh}{unit ? ` · ${unit.items.length} 个文法 · 掌握 ${Math.round(p * 100)}%` : " · 待导入"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const step = view.steps[view.i];
  const cat = "cat" in step ? step.cat : view.cat;
  const unit = book.data[cat];
  const last = view.i === view.steps.length - 1;
  const item = (id: string) => unit.items.find((x) => x.id === id)!;

  let body: ReactNode = null;
  if (step.type === "intro") body = <Intro unit={unit} />;
  if (step.type === "item") body = <ItemStep key={view.i} cat={cat} unit={unit} it={item(step.id)} idx={step.idx} onAnswer={onAnswer} />;
  if (step.type === "compare") body = <Compare unit={unit} />;
  if (step.type === "quiz") body = <QuizStep key={view.i} cat={cat} unit={unit} i={step.i} onAnswer={onAnswer} onJump={(id) => jumpTo(cat, id)} />;
  if (step.type === "sort") body = <SortStep key={view.i} cat={cat} unit={unit} i={step.i} onAnswer={onAnswer} onJump={(id) => jumpTo(cat, id)} />;
  if (step.type === "summary") {
    body = (
      <Summary
        cat={cat}
        unit={unit}
        results={results}
        hasWrong={wrongSteps(book, results).some((s) => "cat" in s && s.cat === cat)}
        onJump={(id) => jumpTo(cat, id)}
        onWrong={openWrong}
      />
    );
  }
  if (step.type === "wrongdone") {
    body = (
      <div className="panel g-panel">
        <h2 className="g-h">错题过了一遍</h2>
        <p className="muted">这次答对的题已经从错题本里移除。</p>
      </div>
    );
  }

  return (
    <section className="g-lesson">
      <div className="g-lesson-head">
        <button className="chip" onClick={() => setView({ kind: "map" })}>← 文法地图</button>
        <h2>{view.title}</h2>
      </div>
      <div className="g-progress" role="list">
        {view.steps.map((s, k) => (
          <button key={k} role="listitem" className={k < view.i ? "on" : k === view.i ? "cur" : ""} title={s.name} aria-label={s.name} onClick={() => go(k)} />
        ))}
      </div>
      <p className="muted g-stepname">{step.name}</p>
      {body}
      <div className="g-nav">
        <button className="ghost" disabled={view.i === 0} onClick={() => go(view.i - 1)}>← 上一步</button>
        <button className="solid" onClick={() => (last ? setView({ kind: "map" }) : go(view.i + 1))}>{last ? "回到地图" : "下一步 →"}</button>
      </div>
      <p className="muted g-keys"><kbd>←</kbd> <kbd>→</kbd> 切换步骤 · <kbd>1</kbd>–<kbd>4</kbd> 选答案 · <kbd>空格</kbd> 展开例句</p>
    </section>
  );
}

function Intro({ unit }: { unit: GrammarUnit }) {
  const pattern = (id: string) => unit.items.find((x) => x.id === id)?.pattern;
  return (
    <>
      <div className="panel g-panel">
        <h2 className="g-h">这一类在考什么</h2>
        <p>{unit.intro.core}</p>
        <div className="g-flow">
          <div className="g-box">{unit.intro.flow.a}</div>
          <div className="g-arrow">按理说 →</div>
          <div className="g-box expect">{unit.intro.flow.expect}</div>
          <div />
          <div className="g-arrow">实际 ↘</div>
          <div className="g-box real">{unit.intro.flow.real}</div>
        </div>
      </div>
      <div className="panel g-panel">
        <h2 className="g-h">{unit.items.length} 个文法，分成 {unit.intro.groups.length} 组记</h2>
        {unit.intro.groups.map((g) => (
          <div key={g.id} className="g-group">
            <b>{g.title}</b>
            <p className="muted">{g.desc}</p>
            <div className="g-chips">{g.items.map((id) => <span key={id} className="g-chip ja">{pattern(id)}</span>)}</div>
          </div>
        ))}
        <p className="muted">接下来一个一个学。每学完一个，会从已经学过的里面抽一句来考你。</p>
      </div>
    </>
  );
}

function ItemStep({ cat, unit, it, idx, onAnswer }: { cat: string; unit: GrammarUnit; it: GrammarItem; idx: number; onAnswer: Answer }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Set<number>>(new Set());

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== " " || (e.target as HTMLElement).closest?.("input, textarea, button")) return;
      e.preventDefault();
      if (!open) setOpen(true);
      else setShown((s) => (s.size === it.examples.length ? new Set() : new Set(it.examples.map((_, k) => k))));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <>
      <div className="panel g-panel">
        <p className="g-pattern ja">{it.pattern}{it.alt && <small>{it.alt}</small>}</p>
        <p className="g-meaning">{it.zh}</p>
        <p className="muted ja">{it.ja}</p>
        <p className="g-label">接续</p>
        {it.connect.map((row, r) => (
          <div key={r} className="g-formula ja">{row.map(([text, kind], k) => <span key={k} className={`g-blk ${kind}`}>{text}</span>)}</div>
        ))}
        <p className="g-label">常见搭配</p>
        <div className="g-chips ja">{it.colloc.map((c) => <span key={c} className="g-chip">{c}</span>)}</div>
      </div>
      {!open ? (
        <button className="ghost g-reveal" onClick={() => setOpen(true)}>看例句和注意点</button>
      ) : (
        <>
          <div className="panel g-panel">
            <h2 className="g-h">例句 <span className="muted">点句子看中文</span></h2>
            {it.examples.map((ex, k) => (
              <button
                key={k}
                className="g-ex"
                onClick={() => setShown((s) => {
                  const next = new Set(s);
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                  return next;
                })}
              >
                <span className="ja"><Marked text={ex.ja} /></span>
                {shown.has(k) && <span className="muted">{ex.zh}</span>}
              </button>
            ))}
          </div>
          <div className="panel g-panel">
            <h2 className="g-h">注意点</h2>
            <ul className="g-notes">{it.notes.map((n, k) => <li key={k}><Marked text={n} /></li>)}</ul>
          </div>
          <Check cat={cat} unit={unit} idx={idx} onAnswer={onAnswer} />
        </>
      )}
    </>
  );
}

/** Blanks a sentence from a grammar point learned so far, leaning towards earlier ones. */
function Check({ cat, unit, idx, onAnswer }: { cat: string; unit: GrammarUnit; idx: number; onAnswer: Answer }) {
  // Drawn once when the check first shows.
  const [q] = useState(() => {
    const learned = unit.items.slice(0, idx + 1);
    const current = learned[learned.length - 1];
    const pool = learned.length > 1 && Math.random() < 0.6 ? learned.slice(0, -1) : [current];
    const target = pool[Math.floor(Math.random() * pool.length)];
    const ex = target.examples[Math.floor(Math.random() * target.examples.length)];
    const opts = shuffled([target, ...shuffled(unit.items.filter((x) => x.id !== target.id)).slice(0, 3)]);
    return { target, ex, opts, review: target.id !== current.id };
  });
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string) => {
    if (picked) return;
    setPicked(id);
    onAnswer(checkId(cat, q.target.id), id === q.target.id);
  };
  useNumberKeys((n) => q.opts[n - 1] && pick(q.opts[n - 1].id));
  const ok = picked === q.target.id;

  return (
    <div className="panel g-panel">
      <h2 className="g-h">小检查 <span className="muted">{q.review ? "复习前面的" : "刚学的"}</span></h2>
      <p className="g-q ja"><Marked text={q.ex.ja} blank /></p>
      <div className="g-opts">
        {q.opts.map((o, k) => (
          <button key={o.id} className={`g-opt ja${picked && o.id === q.target.id ? " ok" : ""}${picked === o.id && !ok ? " ng" : ""}`} disabled={!!picked} onClick={() => pick(o.id)}>
            <span className="g-k">{k + 1}</span>{o.pattern}
          </button>
        ))}
      </div>
      {picked && (
        <div className={`g-fb ${ok ? "ok" : "ng"}`}>
          <p>{ok ? "✓ 对了" : <>✗ 应该是 <b className="ja">{q.target.pattern}</b></>}</p>
          <p className="ja"><Marked text={q.ex.ja} /></p>
          <p className="muted">{q.ex.zh}</p>
        </div>
      )}
    </div>
  );
}

function Compare({ unit }: { unit: GrammarUnit }) {
  return (
    <>
      <div className="panel g-panel">
        <h2 className="g-h">一句话区分</h2>
        {unit.compare.map((c, k) => (
          <div key={k} className="g-vs">
            <div className="ja"><b>{c.a}</b><span className="muted">vs</span><b>{c.b}</b></div>
            <p>{c.point}</p>
          </div>
        ))}
      </div>
      <div className="panel g-panel">
        <h2 className="g-h">做题技巧</h2>
        <p>先看空格<b>后面</b>：后项是决心、无所谓，还是白搭、做不到？再回头看前项是事实，还是「我以为」。</p>
      </div>
    </>
  );
}

function QuizStep({ cat, unit, i, onAnswer, onJump }: { cat: string; unit: GrammarUnit; i: number; onAnswer: Answer; onJump: (id: string) => void }) {
  const q = unit.quiz[i];
  const [picked, setPicked] = useState(0);
  const pick = (n: number) => {
    if (picked) return;
    setPicked(n);
    onAnswer(quizId(cat, i), n === q.ans);
  };
  useNumberKeys(pick);
  const ok = picked === q.ans;
  const it = unit.items.find((x) => x.id === q.item);

  return (
    <div className="panel g-panel">
      <p className="muted ja">次の文の（　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。</p>
      <p className="g-q ja">{q.q}</p>
      <div className="g-opts">
        {q.opts.map((o, k) => (
          <button key={k} className={`g-opt ja${picked && k + 1 === q.ans ? " ok" : ""}${picked === k + 1 && !ok ? " ng" : ""}`} disabled={!!picked} onClick={() => pick(k + 1)}>
            <span className="g-k">{k + 1}</span>{o}
          </button>
        ))}
      </div>
      {picked > 0 && (
        <div className={`g-fb ${ok ? "ok" : "ng"}`}>
          <p>{ok ? "✓ 正确" : `✗ 正确答案是 ${q.ans}`}　{q.why}</p>
          {it && <p>考点：<button className="g-link ja" onClick={() => onJump(it.id)}>{it.pattern}</button></p>}
        </div>
      )}
    </div>
  );
}

function SortStep({ cat, unit, i, onAnswer, onJump }: { cat: string; unit: GrammarUnit; i: number; onAnswer: Answer; onJump: (id: string) => void }) {
  const q = unit.sort[i];
  const [order, setOrder] = useState<number[]>([]);
  const done = order.length === 4;
  const ok = done && order.every((n, k) => n === q.order[k]);
  const it = unit.items.find((x) => x.id === q.item);

  const add = (n: number) => {
    if (done || order.includes(n)) return;
    const next = [...order, n];
    setOrder(next);
    if (next.length === 4) onAnswer(sortId(cat, i), next.every((m, k) => m === q.order[k]));
  };
  useNumberKeys(add);

  return (
    <div className="panel g-panel">
      <p className="muted ja">次の文の ★ に入る最もよいものを、1・2・3・4から一つ選びなさい。</p>
      <p className="muted">按顺序点下面的词块填进空格，点已填的空格可以取消。</p>
      <p className="g-sentence ja">
        {q.pre}
        {[0, 1, 2, 3].map((k) => (
          <button
            key={k}
            className={`g-slot${k + 1 === q.star ? " star" : ""}${done ? (order[k] === q.order[k] ? " ok" : " ng") : ""}`}
            disabled={done || order[k] === undefined}
            onClick={() => setOrder(order.filter((_, j) => j !== k))}
          >
            {order[k] ? q.pieces[order[k] - 1] : " "}
          </button>
        ))}
        {q.post}
      </p>
      <div className="g-pieces ja">
        {q.pieces.map((p, k) => (
          <button key={k} className="g-opt" disabled={done || order.includes(k + 1)} onClick={() => add(k + 1)}>
            <span className="g-k">{k + 1}</span>{p}
          </button>
        ))}
      </div>
      {done && (
        <div className={`g-fb ${ok ? "ok" : "ng"}`}>
          <p>{ok ? "✓ 正确" : `✗ 正确顺序 ${q.order.join("")}`}　★ 的答案是 <b>{q.order[q.star - 1]}</b></p>
          <p className="ja">{q.pre + q.order.map((n) => q.pieces[n - 1]).join("") + q.post}</p>
          <p>
            {it && <>考点：<button className="g-link ja" onClick={() => onJump(it.id)}>{it.pattern}</button></>}
            {!ok && <button className="g-link" onClick={() => setOrder([])}>　再排一次</button>}
          </p>
        </div>
      )}
    </div>
  );
}

function Summary(props: { cat: string; unit: GrammarUnit; results: Results; hasWrong: boolean; onJump: (id: string) => void; onWrong: () => void }) {
  const { cat, unit, results } = props;
  const quizOk = unit.quiz.filter((_, i) => results[quizId(cat, i)]?.ok).length;
  const sortOk = unit.sort.filter((_, i) => results[sortId(cat, i)]?.ok).length;
  return (
    <>
      <div className="panel g-panel">
        <h2 className="g-h">这一类的成绩</h2>
        <div className="g-score">
          <div><b>{quizOk}/{unit.quiz.length}</b><span className="muted">问题5 选择</span></div>
          <div><b>{sortOk}/{unit.sort.length}</b><span className="muted">问题6 排序</span></div>
        </div>
      </div>
      <div className="panel g-panel">
        <h2 className="g-h">每个文法的掌握度</h2>
        {unit.items.map((it) => {
          const m = Math.round(mastery(cat, unit, it.id, results) * 100);
          return (
            <div key={it.id} className="g-mastery">
              <button className="g-link ja" onClick={() => props.onJump(it.id)}>{it.pattern}</button>
              <span className="g-bar"><i style={{ width: `${m}%` }} /></span>
              <span className="muted">{m}%</span>
            </div>
          );
        })}
        {props.hasWrong && <button className="solid g-wrong" onClick={props.onWrong}>做错题</button>}
      </div>
    </>
  );
}
