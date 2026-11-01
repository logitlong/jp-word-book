import { Fragment, useEffect, useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import { loadUnitEntries } from "./lib/cloud";
import { EXAM_BANK, EXAM_SECTIONS, type ExamItem } from "./lib/examBank";
import { shuffled } from "./lib/store";
import type { QuizResult } from "./lib/sync";
import { Segmented } from "./pages";

export type QuizMode = "exam" | "words";
type QuizFilter = "all" | "unseen" | "done" | "wrong";

interface Question {
  id: string;
  section: string;
  rule: string;
  stem: string;
  headword: boolean;
  word: string;
  answer: string;
  /** Built when shown, since ranking distractors across the deck is slow for long quizzes. */
  makeOptions: () => string[];
}

const MODE_LABEL: Record<QuizMode, string> = { exam: "真题形式", words: "单词测验" };
const COUNTS: Record<QuizMode, number[]> = { exam: [25, 50, 100], words: [20, 30, 50] };
const FULL_PAPER = EXAM_SECTIONS.reduce((sum, section) => sum + section.count, 0);

/** First clause of a definition, so explanations stay short and readable. */
const shortMeaning = (meaning: string) => {
  const text = meaning.replace(/^\s*[（(<〈][^）)>〉]*[）)>〉]/, "");
  return (text.split(/[。；;（(]/)[0] || text || meaning).slice(0, 30);
};

const examQuestions = (items: ExamItem[]): Question[] =>
  EXAM_SECTIONS.flatMap((section) =>
    items
      .filter((item) => item.type === section.type)
      .map((item) => ({
        id: `e:${item.word}:${item.type}`,
        section: section.title,
        rule: section.rule,
        stem: item.stem,
        headword: item.type === "usage",
        word: item.word,
        answer: item.options[0],
        makeOptions: () => shuffled(item.options),
      })),
  );

/** Exactly `count` questions keeping the exam's share of each section, in exam order. */
function drawExam(questions: Question[], count: number) {
  if (count >= questions.length) return questions;
  const mixed = shuffled(questions);
  const picked = new Set(
    EXAM_SECTIONS.flatMap((section) =>
      mixed.filter((q) => q.section === section.title).slice(0, Math.round((count * section.count) / FULL_PAPER)),
    ),
  );
  for (const question of mixed) {
    if (picked.size >= count) break;
    picked.add(question);
  }
  return questions.filter((q) => picked.has(q)).slice(0, count);
}

/** Short quizzes cover as many different words as they can before asking one again. */
function drawWords(questions: Question[], count: number) {
  const seen = new Map<string, number>();
  const ranked = shuffled(questions).map((question) => {
    const rank = seen.get(question.word) ?? 0;
    seen.set(question.word, rank + 1);
    return { question, rank };
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return shuffled(ranked.slice(0, count).map((r) => r.question));
}

const closeness = (note: Note, other: Note) =>
  (note.reading[0] === other.reading[0] ? 2 : 0) +
  (note.pos === other.pos ? 1 : 0) +
  (note.reading.length === other.reading.length ? 1 : 0);

type Face = "word" | "reading" | "meaning";

const FACE_LABEL: Record<Face, string> = { word: "汉字", reading: "读音", meaning: "释义" };
const faceOf = (note: Note, face: Face) =>
  face === "meaning" ? shortMeaning(note.meaning) : face === "reading" && hasKanji(note) ? note.reading : note.word;
const hasKanji = (note: Note) => /[\u4e00-\u9fff]/.test(note.word);

function faceQuestion(note: Note, from: Face, to: Face, pool: Note[]): Question {
  const answer = faceOf(note, to);
  const stem = faceOf(note, from);
  return {
    id: `w:${note.id}:${from}:${to}`,
    section: `看${FACE_LABEL[from]}选${FACE_LABEL[to]}`,
    rule: `看${FACE_LABEL[from]}，选出对应的${FACE_LABEL[to]}。`,
    stem,
    headword: from !== "meaning",
    word: note.word,
    answer,
    makeOptions: () => {
      // Words sharing the prompt would make a second correct answer.
      const ranked = shuffled(pool)
        .filter((other) => faceOf(other, to) !== answer && faceOf(other, from) !== stem && faceOf(other, to))
        .sort((a, b) => closeness(note, b) - closeness(note, a));
      return shuffled([answer, ...[...new Set(ranked.map((other) => faceOf(other, to)))].slice(0, 3)]);
    },
  };
}

/** Every way of asking every word. */
const wordQuestions = (scope: Note[], pool: Note[]) =>
  scope.flatMap((note) => {
    const faces: Face[] = hasKanji(note) ? ["word", "reading", "meaning"] : ["reading", "meaning"];
    return faces.flatMap((from) => faces.filter((to) => to !== from).map((to) => faceQuestion(note, from, to, pool)));
  });

function Stem({ text }: { text: string }) {
  return (
    <>
      {text.split(/\{(.+?)\}/).map((part, i) => (i % 2 ? <u key={i}>{part}</u> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

export function Quiz(props: {
  title: string;
  mode: QuizMode;
  scope: Note[];
  pool: Note[];
  results: Record<string, QuizResult>;
  onAnswer: (id: string, ok: boolean) => void;
  onClose: () => void;
  onStarWrong: (ids: string[]) => void;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [examItems, setExamItems] = useState<ExamItem[] | null>(null);

  useEffect(() => {
    if (props.mode !== "exam") return;
    let current = true;
    void Promise.all([...new Set(props.scope.map((n) => n.unit))].map(loadUnitEntries)).then((units) => {
      if (!current) return;
      const entries = units.flatMap((unit) => Object.values(unit));
      const ids = new Set(props.scope.map((n) => n.id));
      const items = entries.filter((e) => ids.has(e.id)).flatMap((e) => e.exams.map((q) => ({ ...q, word: e.word })));
      setExamItems(items.length ? items : EXAM_BANK);
    });
    return () => {
      current = false;
    };
  }, [props.mode, props.scope]);

  const all = useMemo(
    () => (props.mode === "exam" ? examQuestions(examItems ?? []) : wordQuestions(props.scope, props.pool)),
    [props.mode, props.scope, props.pool, examItems],
  );
  const unseen = all.filter((q) => !props.results[q.id]);
  const missed = all.filter((q) => props.results[q.id]?.ok === false);
  const correct = all.length - unseen.length - missed.length;
  const [filter, setFilter] = useState<QuizFilter>("all");
  const [custom, setCustom] = useState("");
  const attempted = all.filter((q) => props.results[q.id]);
  const candidates = { all, unseen, done: attempted, wrong: missed }[filter];
  const available = candidates.length;
  const customCount = Math.min(available, Math.max(1, Math.floor(Number(custom)) || 0));
  const begin = (count: number) => setQuestions((props.mode === "exam" ? drawExam : drawWords)(candidates, count));
  const noteOf = (word: string) => props.pool.find((n) => n.word === word);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<Question[]>([]);
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState(false);
  const question = finished ? undefined : questions?.[index];
  const options = useMemo(() => question?.makeOptions() ?? [], [question]);
  const note = question && noteOf(question.word);
  const answered = (questions ?? []).slice(0, picked === null ? index : index + 1);
  const wrongNotes = wrong.flatMap((item) => noteOf(item.word) ?? []);
  const sections = [...new Set(answered.map((q) => q.section))];

  const pick = (option: string) => {
    if (picked !== null || !question) return;
    setPicked(option);
    if (option !== question.answer) setWrong((list) => [...list, question]);
    props.onAnswer(question.id, option === question.answer);
  };
  const retryWrong = () => {
    setQuestions(shuffled(wrong));
    setWrong([]);
    setIndex(0);
    setPicked(null);
    setFinished(false);
  };
  const next = () => {
    if (index + 1 === questions?.length) {
      setFinished(true);
      return;
    }
    setPicked(null);
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (picked !== null && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        next();
      } else if (question && "1234".includes(e.key)) {
        const option = options[Number(e.key) - 1];
        if (option) pick(option);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="overlay full">
      <section className="sheet quiz-sheet" role="dialog" aria-label="测验">
        <button className="round sheet-close" onClick={props.onClose} aria-label="关闭">✕</button>
        {!questions ? (
          <>
            <p className="sheet-meta">{props.title} · {MODE_LABEL[props.mode]}</p>
            <h2 className="sheet-title">这次测验多少题？</h2>
            <p className="exam-rule">
              {all.length ? `共 ${all.length} 题：未做 ${unseen.length}，做对 ${correct}，错题 ${missed.length}` : "正在准备题目…"}
            </p>
            {all.length > 0 && (
              <Segmented
                label="题目范围"
                value={filter}
                options={[
                  { value: "all", label: `全部 ${all.length}` },
                  { value: "unseen", label: `未做 ${unseen.length}` },
                  { value: "done", label: `已做 ${attempted.length}` },
                  { value: "wrong", label: `错题 ${missed.length}` },
                ]}
                onChange={setFilter}
              />
            )}
            {available > 0 ? (
              <>
                <div className="count-choices">
                  {COUNTS[props.mode].filter((count) => count < available).map((count) => (
                    <button className="ghost" key={count} onClick={() => begin(count)}>{count} 题</button>
                  ))}
                  <button className="solid" onClick={() => begin(available)}>全部 {available} 题</button>
                </div>
                <form
                  className="count-custom"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customCount) begin(customCount);
                  }}
                >
                  <label>
                    自定义
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={available}
                      placeholder={`1–${available}`}
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                    题
                  </label>
                  <button className="ghost" disabled={!customCount}>开始</button>
                </form>
              </>
            ) : (
              all.length > 0 && <p className="muted">这个范围里没有题目。</p>
            )}
          </>
        ) : question ? (
          <>
            <p className="sheet-meta">{question.section} · {index + 1} / {questions?.length}</p>
            <p className="exam-rule">{question.rule}</p>
            <p className={`exam-stem${question.headword ? " word" : ""}`}><Stem text={question.stem} /></p>
            <div className="options">
              {options.map((option, i) => {
                const state = picked === null ? "" : option === question.answer ? "right" : option === picked ? "wrong" : "";
                return (
                  <button key={option} className={state} onClick={() => pick(option)}>
                    <kbd>{i + 1}</kbd>{option}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <div className="quiz-next">
                <span>{question.word}{note ? ` ${note.reading} · ${shortMeaning(note.meaning)}` : ""}</span>
                <button className="solid" onClick={next}>{index + 1 === questions?.length ? "看结果" : "下一题"}</button>
              </div>
            )}
            {index > 0 && <button className="quiz-finish" onClick={() => setFinished(true)}>提前交卷</button>}
          </>
        ) : (
          <>
            <p className="sheet-meta">{props.title} · {MODE_LABEL[props.mode]} 完成</p>
            <h2 className="sheet-title">答对 {answered.length - wrong.length} / {answered.length}</h2>
            <ul className="exam-score">
              {sections.map((section) => {
                const total = answered.filter((q) => q.section === section).length;
                return (
                  <li key={section}>
                    <span>{section}</span>
                    <b>{total - wrong.filter((q) => q.section === section).length} / {total}</b>
                  </li>
                );
              })}
            </ul>
            {wrong.length > 0 && (
              <ul className="wrong-list">
                {wrong.map((item) => {
                  const n = noteOf(item.word);
                  return <li key={item.section + item.word}><b>{item.word}</b><span>{n?.reading}</span><small>{n ? shortMeaning(n.meaning) : ""}</small></li>;
                })}
              </ul>
            )}
            <p className="sheet-note">
              {props.mode === "exam" ? "题目是原创练习题，不是历年真题。" : ""}测验不影响复习安排。
            </p>
            <div className="sheet-actions">
              {wrongNotes.length > 0 && (
                <button
                  className="ghost"
                  disabled={saved}
                  onClick={() => {
                    props.onStarWrong(wrongNotes.map((n) => n.id));
                    setSaved(true);
                  }}
                >
                  {saved ? "已加入生词本" : "错题加入生词本"}
                </button>
              )}
              {wrong.length > 0 && <button className="ghost" onClick={retryWrong}>重做这 {wrong.length} 道错题</button>}
              <button className="solid" onClick={props.onClose}>完成</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
