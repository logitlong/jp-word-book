import { Fragment, useEffect, useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import { loadUnitEntries } from "./lib/cloud";
import { EXAM_BANK, EXAM_SECTIONS, type ExamItem } from "./lib/examBank";
import { shuffled } from "./lib/store";

export type QuizMode = "exam" | "words";

interface Question {
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

/** A paper keeping the exam's share of each section, in exam order. */
function buildExam(items: ExamItem[], count: number): Question[] {
  return EXAM_SECTIONS.flatMap((section) => {
    const share = Math.round((count * section.count) / FULL_PAPER);
    return shuffled(items.filter((item) => item.type === section.type))
      .slice(0, count >= items.length ? undefined : share)
      .map((item) => ({
        section: section.title,
        rule: section.rule,
        stem: item.stem,
        headword: item.type === "usage",
        word: item.word,
        answer: item.options[0],
        makeOptions: () => shuffled(item.options),
      }));
  });
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

/** Every way of asking every word. Short quizzes cover as many different words as they can. */
function buildWordQuiz(scope: Note[], pool: Note[], count: number): Question[] {
  const rounds = scope.map((note) => {
    const faces: Face[] = hasKanji(note) ? ["word", "reading", "meaning"] : ["reading", "meaning"];
    const pairs = faces.flatMap((from) => faces.filter((to) => to !== from).map((to) => [from, to] as const));
    return shuffled(pairs).map(([from, to]) => ({ note, from, to }));
  });
  const queue = [0, 1, 2, 3, 4, 5].flatMap((round) => shuffled(rounds.flatMap((pairs) => pairs[round] ?? [])));
  return shuffled(queue.slice(0, count)).map(({ note, from, to }) => faceQuestion(note, from, to, pool));
}

const wordQuizSize = (scope: Note[]) => scope.reduce((sum, note) => sum + (hasKanji(note) ? 6 : 2), 0);

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

  const available = props.mode === "exam" ? (examItems?.length ?? 0) : wordQuizSize(props.scope);
  const begin = (count: number) =>
    setQuestions(props.mode === "exam" ? buildExam(examItems ?? [], count) : buildWordQuiz(props.scope, props.pool, count));
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
    <div className="overlay" onClick={props.onClose}>
      <section className="sheet" role="dialog" aria-label="测验" onClick={(e) => e.stopPropagation()}>
        {!questions ? (
          <>
            <p className="sheet-meta">{props.title} · {MODE_LABEL[props.mode]}</p>
            <h2 className="sheet-title">这次测验多少题？</h2>
            <p className="exam-rule">{available ? `这个分组一共可以出 ${available} 题。` : "正在准备题目…"}</p>
            <div className="count-choices">
              {COUNTS[props.mode].filter((count) => count < available).map((count) => (
                <button className="ghost" key={count} onClick={() => begin(count)}>{count} 题</button>
              ))}
              {available > 0 && <button className="solid" onClick={() => begin(available)}>全部 {available} 题</button>}
            </div>
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
              <button className="solid" onClick={props.onClose}>完成</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
