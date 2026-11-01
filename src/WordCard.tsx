import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "./lib/apkg";
import { loadUnitEntries, loadWordAudio, type WordEntry } from "./lib/cloud";
import { accentType, circled, isDrawable, pitchPattern } from "./lib/pitch";
import {
  formatInterval,
  previewIntervals,
  Rating,
  statusOf,
  type Grade,
  type Progress,
  type Settings,
  type Status,
} from "./lib/store";

const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: "不认识", key: "1" },
  { rating: Rating.Good, label: "认识", key: "2" },
];

const FRONT_HINT = {
  read: "先在心里读出来，再看答案",
  listen: "听发音，回想这个词",
  recall: "看释义，回想日语单词",
};

function PitchReading({ reading, accent }: { reading: string; accent: number }) {
  return (
    <span className="pitch" aria-label={`${reading}，声调 ${accent}`}>
      {pitchPattern(reading, accent).map((m, i) => (
        <span key={i} className={`mora${m.high ? " high" : ""}${m.step ? " step" : ""}${m.drop ? " drop" : ""}`}>
          {m.text}
        </span>
      ))}
    </span>
  );
}

interface Props {
  note: Note;
  index: number;
  total: number;
  progress: Progress;
  settings: Settings;
  /** Study mode hides the answer until revealed and grades instead of paging. */
  study: boolean;
  tag: string;
  canUndo: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onGrade: (rating: Grade) => void;
  onStatus: (status: Status) => void;
  onNote: (text: string) => void;
  onVoice: (voice: 1 | 2) => void;
  onSettings: () => void;
  onStar: () => void;
  onFamiliar: () => void;
  onUndo: () => void;
}

export function WordCard(props: Props) {
  const { note, index, total, progress, settings, study, tag } = props;
  const [revealed, setRevealed] = useState(!study);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef("");
  const playRequest = useRef(0);
  const jaVoice = useRef<SpeechSynthesisVoice | null>(null);
  const [hasJaVoice, setHasJaVoice] = useState(false);
  const [entry, setEntry] = useState<WordEntry | undefined>();

  useEffect(() => {
    let current = true;
    setEntry(undefined);
    void loadUnitEntries(note.unit).then((entries) => current && setEntry(entries[note.id]));
    return () => {
      current = false;
    };
  }, [note.id, note.unit]);

  useEffect(() => {
    const pick = () => {
      jaVoice.current = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja")) ?? null;
      setHasJaVoice(!!jaVoice.current);
    };
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  const stop = useCallback(() => {
    playRequest.current += 1;
    audioRef.current?.pause();
    speechSynthesis.cancel();
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    stop();
    setMissing(false);
    if (settings.voice === 2 && jaVoice.current) {
      const utterance = new SpeechSynthesisUtterance(note.reading);
      utterance.voice = jaVoice.current;
      utterance.lang = "ja-JP";
      utterance.onend = () => setPlaying(false);
      setPlaying(true);
      speechSynthesis.speak(utterance);
      return;
    }
    const request = ++playRequest.current;
    const blob = note.audio ? await loadWordAudio(note.audio) : undefined;
    // The word may have changed while its audio was downloading.
    if (request !== playRequest.current) return;
    if (!blob) {
      setMissing(true);
      return;
    }
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    const audio = new Audio(urlRef.current);
    audio.onended = () => setPlaying(false);
    audioRef.current = audio;
    setPlaying(true);
    await audio.play().catch(() => setPlaying(false));
  }, [note, settings.voice, stop]);

  useEffect(() => stop, [note.id, stop]);

  const listenFront = study && settings.mode === "listen";
  useEffect(() => {
    if (settings.autoplay && (revealed || listenFront)) void play();
    // Play once per word; switching voice replays through the buttons below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, revealed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tagName = (e.target as HTMLElement).tagName;
      if (tagName === "TEXTAREA" || tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      if (key === "escape") props.onClose();
      else if (key === "r") void play();
      else if (key === "s") props.onStar();
      else if (study && key === "f") props.onFamiliar();
      else if (study && key === "z" && props.canUndo) props.onUndo();
      else if (study && !revealed && (key === " " || key === "enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (study && revealed && "12".includes(key)) {
        props.onGrade(GRADES[Number(key) - 1].rating);
      } else if (!study && key === "arrowleft") props.onPrev();
      else if (!study && key === "arrowright") props.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, props, revealed, study]);

  const status = statusOf(note.id, progress);
  const intervals = previewIntervals(progress.cards[note.id], settings.retention);
  const starred = !!progress.starred[note.id];
  const showWord = revealed || settings.mode === "read" || !study;
  const pills: { value: Status; label: string; active: boolean }[] = [
    { value: "new", label: "未学", active: status === "new" },
    { value: "learning", label: status === "mastered" ? "已掌握" : "学习中", active: status === "learning" || status === "mastered" },
    { value: "familiar", label: "已熟悉", active: status === "familiar" },
  ];

  return (
    // A stray tap must not end a study round, so only browsing closes from outside.
    <div className="overlay full" onClick={study ? undefined : props.onClose}>
      <section
        className="word-card"
        role="dialog"
        aria-label={note.word}
        onClick={(e) => {
          e.stopPropagation();
          if (study && !revealed && !(e.target as HTMLElement).closest("button")) setRevealed(true);
        }}
      >
        <div className={`card-scroll${revealed ? "" : " front"}`}>
          <header className="card-top">
            <span className="tag">
              <i />
              {tag}
            </span>
            <div className="card-actions">
              {study && props.canUndo && (
                <button className="chip" onClick={props.onUndo} title="撤销上一步（Z）">撤销</button>
              )}
              {study && (
                <button className="chip" onClick={props.onFamiliar} title="标记已熟悉，不再安排复习（F）">已熟悉</button>
              )}
              <button className={`round${starred ? " starred" : ""}`} onClick={props.onStar} aria-pressed={starred} aria-label="加入生词本" title="生词本（S）">
                {starred ? "★" : "☆"}
              </button>
              <button className="round" onClick={props.onSettings} aria-label="设置">⚙</button>
              <button className="round" onClick={props.onClose} aria-label="关闭">✕</button>
            </div>
          </header>

          {revealed ? (
            <div className="card-body">
              <div className="card-side">
                <h1 className="headword">{note.word}</h1>
                {note.accents.map((a) => (
                  <div className="reading-row" key={a}>
                    {isDrawable(note.reading, a) ? (
                      <>
                        <PitchReading reading={note.reading} accent={a} />
                        <span className="accent-mark">{circled(a)}</span>
                        <span className="accent-type">{accentType(note.reading, a)}</span>
                      </>
                    ) : (
                      <>
                        <span className="pitch">{note.reading}</span>
                        <span className="accent-mark">{circled(a)}</span>
                        <span className="accent-type">牌组标注有误，无法画声调</span>
                      </>
                    )}
                  </div>
                ))}
                {!note.accents.length && (
                  <div className="reading-row">
                    <span className="pitch">{note.reading}</span>
                    <span className="accent-type">牌组未标声调</span>
                  </div>
                )}

                <div className="listen-row">
                  <button className={`listen${playing ? " playing" : ""}`} onClick={() => void play()}>
                    <span className="play-dot">▶</span>听发音<kbd>R</kbd>
                  </button>
                  <div className="voices" role="group" aria-label="声音">
                    <button className={settings.voice === 1 ? "active" : ""} onClick={() => props.onVoice(1)}>
                      牌组语音
                    </button>
                    <button
                      className={settings.voice === 2 ? "active" : ""}
                      disabled={!hasJaVoice}
                      title={hasJaVoice ? "浏览器自带的日语语音，声调可能和牌组不同" : "这台设备没有日语系统语音"}
                      onClick={() => props.onVoice(2)}
                    >
                      系统语音
                    </button>
                  </div>
                  {missing && <span className="audio-note">这个词没有音频</span>}
                </div>
              </div>

              <div className="card-detail">
                {entry ? (
                  <ol className="senses">
                    {entry.senses.map((sense, i) => (
                      <li key={i}>
                        <p className="sense-zh"><span className="pos">{sense.pos}</span>{sense.zh}</p>
                        <p className="sense-ja">{sense.ja}</p>
                        {sense.examples.map((example, j) => (
                          <div className="example" key={j}>
                            <p lang="ja">{example.ja}</p>
                            <p>{example.zh}</p>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <>
                    {note.pos && <p className="pos">{note.pos}</p>}
                    <p className="meaning">{note.meaning}</p>
                  </>
                )}
                <hr />

                <h2>学习进度</h2>
                <div className="pills">
                  {pills.map((s) => (
                    <button key={s.value} className={s.active ? "active" : ""} onClick={() => props.onStatus(s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <hr />

                <h2>我的笔记</h2>
                <textarea
                  value={progress.notes[note.id] ?? ""}
                  placeholder="写下容易混淆的地方、自己的例句"
                  onChange={(e) => props.onNote(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <>
              {showWord ? (
                <h1 className="headword">{note.word}</h1>
              ) : (
                <h1 className="headword hidden-word">？</h1>
              )}
              {settings.mode === "recall" && <p className="meaning">{note.meaning}</p>}
              {settings.mode === "listen" && (
                <div className="listen-row">
                  <button className={`listen${playing ? " playing" : ""}`} onClick={() => void play()}>
                    <span className="play-dot">▶</span>听发音<kbd>R</kbd>
                  </button>
                </div>
              )}
              <p className="prompt">{FRONT_HINT[settings.mode]}</p>
              <p className="tap-hint">点屏幕任意位置看答案</p>
            </>
          )}
        </div>

        <footer className="card-bottom">
          {!study ? (
            <>
              <button className="ghost" onClick={props.onPrev}>← 上一个</button>
              <span className="count">{index + 1} / {total.toLocaleString()}</span>
              <button className="solid" onClick={props.onNext}>下一个 →</button>
            </>
          ) : !revealed ? (
            <>
              <span className="count">剩余 {total - index}</span>
              <button className="solid" onClick={() => setRevealed(true)}>显示答案 <kbd>空格</kbd></button>
            </>
          ) : (
            <div className="grades">
              {GRADES.map((g) => (
                <button key={g.key} onClick={() => props.onGrade(g.rating)}>
                  <b>{g.label}</b>
                  <small>{formatInterval(intervals[g.rating])}</small>
                </button>
              ))}
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
