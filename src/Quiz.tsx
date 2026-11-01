import { useEffect, useMemo, useState } from "react";
import type { Note } from "./lib/apkg";
import { shuffled } from "./lib/store";

const QUESTIONS = 10;

/** First clause of a definition, so options stay short and readable. */
const shortMeaning = (meaning: string) => {
  const text = meaning.replace(/^\s*[（(<〈][^）)>〉]*[）)>〉]/, "");
  return (text.split(/[。；;（(]/)[0] || text || meaning).slice(0, 30);
};

function buildQuestions(scope: Note[], pool: Note[]) {
  return shuffled(scope)
    .slice(0, QUESTIONS)
    .map((note) => {
      const answer = shortMeaning(note.meaning);
      const wrong = new Set<string>();
      for (const other of shuffled(pool)) {
        const text = shortMeaning(other.meaning);
        if (other.id !== note.id && text && text !== answer) wrong.add(text);
        if (wrong.size === 3) break;
      }
      return { note, answer, options: shuffled([answer, ...wrong]) };
    });
}

export function Quiz(props: {
  title: string;
  scope: Note[];
  pool: Note[];
  onClose: () => void;
  onStarWrong: (ids: string[]) => void;
}) {
  const questions = useMemo(() => buildQuestions(props.scope, props.pool), [props.scope, props.pool]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<Note[]>([]);
  const [saved, setSaved] = useState(false);
  const question = questions[index];

  const pick = (option: string) => {
    if (picked !== null || !question) return;
    setPicked(option);
    if (option !== question.answer) setWrong((list) => [...list, question.note]);
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
            <p className="sheet-meta">{props.title} · 测验 {index + 1} / {questions.length}</p>
            <h1 className="headword quiz-word">{question.note.word}</h1>
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
                <span>{question.note.reading}</span>
                <button className="solid" onClick={next}>下一题</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="sheet-meta">{props.title} · 测验完成</p>
            <h2 className="sheet-title">答对 {questions.length - wrong.length} / {questions.length}</h2>
            {wrong.length > 0 && (
              <ul className="wrong-list">
                {wrong.map((n) => (
                  <li key={n.id}><b>{n.word}</b><span>{n.reading}</span><small>{shortMeaning(n.meaning)}</small></li>
                ))}
              </ul>
            )}
            <p className="sheet-note">测验不影响复习安排。</p>
            <div className="sheet-actions">
              {wrong.length > 0 && (
                <button
                  className="ghost"
                  disabled={saved}
                  onClick={() => {
                    props.onStarWrong(wrong.map((n) => n.id));
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
