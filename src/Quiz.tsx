import { Fragment, useEffect, useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import { EXAM_BANK, EXAM_SECTIONS } from "./lib/examBank";
import { shuffled } from "./lib/store";

export type QuizMode = "exam" | "words";

interface Question {
  section: string;
  rule: string;
  stem: string;
  headword: boolean;
  word: string;
  answer: string;
  options: string[];
}

const MODE_LABEL: Record<QuizMode, string> = { exam: "真题形式", words: "单词测验" };

/** First clause of a definition, so explanations stay short and readable. */
const shortMeaning = (meaning: string) => {
  const text = meaning.replace(/^\s*[（(<〈][^）)>〉]*[）)>〉]/, "");
  return (text.split(/[。；;（(]/)[0] || text || meaning).slice(0, 30);
};

/** One paper in exam layout, taking the group's own words first. */
function buildExam(scope: Note[]): Question[] {
  const words = new Set(scope.map((n) => n.word));
  return EXAM_SECTIONS.flatMap((section) => {
    const items = shuffled(EXAM_BANK.filter((item) => item.type === section.type));
    const ordered = [...items.filter((item) => words.has(item.word)), ...items.filter((item) => !words.has(item.word))];
    return ordered.slice(0, section.count).map((item) => ({
      section: section.title,
      rule: section.rule,
      stem: item.stem,
      headword: item.type === "usage",
      word: item.word,
      answer: item.options[0],
      options: shuffled(item.options),
    }));
  });
}

const closeness = (note: Note, other: Note) =>
  (note.reading[0] === other.reading[0] ? 2 : 0) +
  (note.pos === other.pos ? 1 : 0) +
  (note.reading.length === other.reading.length ? 1 : 0);

/** Three wrong answers, closest words first, skipping any that would also be correct. */
function distractors(note: Note, pool: Note[], valueOf: (n: Note) => string, excluded: (n: Note) => boolean) {
  const answer = valueOf(note);
  const ranked = shuffled(pool)
    .filter((other) => valueOf(other) !== answer && !excluded(other))
    .sort((a, b) => closeness(note, b) - closeness(note, a));
  return [...new Set(ranked.map(valueOf))].slice(0, 3);
}

/** Every word of the group once, each asked in a randomly chosen way. */
function buildWordQuiz(scope: Note[], pool: Note[]): Question[] {
  return shuffled(scope).map((note) => {
    const hasKanji = note.word !== note.reading;
    const sameReading = (n: Note) => n.reading === note.reading;
    const kinds = hasKanji ? (["reading", "kanji", "meaning"] as const) : (["meaning"] as const);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const base = { headword: true, word: note.word };
    if (kind === "reading") {
      const options = distractors(note, pool, (n) => n.reading, () => false);
      return { ...base, section: "看汉字选读音", rule: "选出这个词的读音。", stem: note.word, answer: note.reading, options: shuffled([note.reading, ...options]) };
    }
    if (kind === "kanji") {
      const options = distractors(note, pool, (n) => n.word, sameReading);
      return { ...base, section: "看读音选汉字", rule: "选出这个读音对应的写法。", stem: note.reading, answer: note.word, options: shuffled([note.word, ...options]) };
    }
    const meaning = shortMeaning(note.meaning);
    const options = distractors(note, pool, (n) => n.word, (n) => shortMeaning(n.meaning) === meaning);
    return { ...base, headword: false, section: "看释义选汉字", rule: "选出符合这个释义的单词。", stem: meaning, answer: note.word, options: shuffled([note.word, ...options]) };
  });
}

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
  const questions = useMemo(
    () => (props.mode === "exam" ? buildExam(props.scope) : buildWordQuiz(props.scope, props.pool)),
    [props.mode, props.scope, props.pool],
  );
  const noteOf = (word: string) => props.pool.find((n) => n.word === word);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<Question[]>([]);
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState(false);
  const question = finished ? undefined : questions[index];
  const note = question && noteOf(question.word);
  const answered = questions.slice(0, picked === null ? index : index + 1);
  const wrongNotes = wrong.flatMap((item) => noteOf(item.word) ?? []);
  const sections = [...new Set(answered.map((q) => q.section))];

  const pick = (option: string) => {
    if (picked !== null || !question) return;
    setPicked(option);
    if (option !== question.answer) setWrong((list) => [...list, question]);
  };
  const next = () => {
    if (index + 1 === questions.length) {
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
        const option = question.options[Number(e.key) - 1];
        if (option) pick(option);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="overlay" onClick={props.onClose}>
      <section className="sheet" role="dialog" aria-label="测验" onClick={(e) => e.stopPropagation()}>
        {question ? (
          <>
            <p className="sheet-meta">{question.section} · {index + 1} / {questions.length}</p>
            <p className="exam-rule">{question.rule}</p>
            <p className={`exam-stem${question.headword ? " word" : ""}`}><Stem text={question.stem} /></p>
            <div className="options">
              {question.options.map((option, i) => {
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
                <button className="solid" onClick={next}>{index + 1 === questions.length ? "看结果" : "下一题"}</button>
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
