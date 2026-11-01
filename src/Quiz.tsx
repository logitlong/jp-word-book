import { Fragment, useEffect, useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import { EXAM_BANK, EXAM_SECTIONS, type ExamItem } from "./lib/examBank";
import { shuffled } from "./lib/store";

/** First clause of a definition, so explanations stay short and readable. */
const shortMeaning = (meaning: string) => {
  const text = meaning.replace(/^\s*[（(<〈][^）)>〉]*[）)>〉]/, "");
  return (text.split(/[。；;（(]/)[0] || text || meaning).slice(0, 30);
};

/** One paper in exam layout, taking the group's own words first. */
function buildExam(scope: Note[]) {
  const words = new Set(scope.map((n) => n.word));
  return EXAM_SECTIONS.flatMap((section) => {
    const items = shuffled(EXAM_BANK.filter((item) => item.type === section.type));
    const ordered = [...items.filter((item) => words.has(item.word)), ...items.filter((item) => !words.has(item.word))];
    return ordered.slice(0, section.count).map((item) => ({ item, section, answer: item.options[0], options: shuffled(item.options) }));
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
  scope: Note[];
  pool: Note[];
  onClose: () => void;
  onStarWrong: (ids: string[]) => void;
}) {
  const questions = useMemo(() => buildExam(props.scope), [props.scope]);
  const noteOf = (word: string) => props.pool.find((n) => n.word === word);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<ExamItem[]>([]);
  const [saved, setSaved] = useState(false);
  const question = questions[index];
  const note = question && noteOf(question.item.word);
  const wrongNotes = wrong.flatMap((item) => noteOf(item.word) ?? []);

  const pick = (option: string) => {
    if (picked !== null || !question) return;
    setPicked(option);
    if (option !== question.answer) setWrong((list) => [...list, question.item]);
  };
  const next = () => {
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
            <p className="sheet-meta">{question.section.title} · {index + 1} / {questions.length}</p>
            <p className="exam-rule">{question.section.rule}</p>
            <p className={`exam-stem${question.item.type === "usage" ? " word" : ""}`}><Stem text={question.item.stem} /></p>
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
                <span>{question.item.word}{note ? ` ${note.reading} · ${shortMeaning(note.meaning)}` : ""}</span>
                <button className="solid" onClick={next}>{index + 1 === questions.length ? "看结果" : "下一题"}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="sheet-meta">{props.title} · 文字・語彙 完成</p>
            <h2 className="sheet-title">答对 {questions.length - wrong.length} / {questions.length}</h2>
            <ul className="exam-score">
              {EXAM_SECTIONS.map((section) => (
                <li key={section.type}>
                  <span>{section.title}</span>
                  <b>{section.count - wrong.filter((item) => item.type === section.type).length} / {section.count}</b>
                </li>
              ))}
            </ul>
            {wrong.length > 0 && (
              <ul className="wrong-list">
                {wrong.map((item) => {
                  const n = noteOf(item.word);
                  return <li key={item.type + item.word}><b>{item.word}</b><span>{n?.reading}</span><small>{n ? shortMeaning(n.meaning) : ""}</small></li>;
                })}
              </ul>
            )}
            <p className="sheet-note">题目是原创练习题，不是历年真题。测验不影响复习安排。</p>
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
