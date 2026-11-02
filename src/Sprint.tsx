import { useEffect, useRef, useState } from "react";
import type { Note } from "./lib/apkg";
import { loadNeuralAudio, loadWordAudio } from "./lib/cloud";

/** Exam words outside the deck only have the neural reading. */
const loadSound = (note: Note) => (note.audio ? loadWordAudio(note.audio) : loadNeuralAudio(note.id));

/** Fast pass over a word list: the word and its sound, one space or tap to move on. */
export function Sprint(props: { title: string; notes: Note[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const note = props.notes[index];
  const next = () => setIndex((i) => Math.min(i + 1, props.notes.length));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const upcoming = props.notes[index + 1];

  useEffect(() => {
    if (!note) return;
    let current = true;
    let url = "";
    void loadSound(note).then((blob) => {
      if (!current || !blob) return;
      url = URL.createObjectURL(blob);
      audioRef.current = new Audio(url);
      void audioRef.current.play().catch(() => undefined);
    });
    // Fetching the next sound now keeps fast tapping in step.
    if (upcoming) void loadSound(upcoming);
    return () => {
      current = false;
      audioRef.current?.pause();
      audioRef.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [note, upcoming]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="sprint" role="dialog" aria-label="速刷" onClick={next}>
      <header>
        <span>{props.title} · {Math.min(index + 1, props.notes.length)} / {props.notes.length}</span>
        <button
          className="round"
          aria-label="关闭"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
        >
          ✕
        </button>
      </header>
      {note ? (
        <>
          <p className="sprint-word" lang="ja">{note.word}</p>
          <p className="sprint-hint">按空格或点击屏幕，下一个</p>
        </>
      ) : (
        <div className="sprint-end">
          <p>刷完了 {props.notes.length} 个词</p>
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setIndex(0);
            }}
          >
            再刷一遍
          </button>
          <button
            className="solid"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
          >
            完成
          </button>
        </div>
      )}
    </div>
  );
}
