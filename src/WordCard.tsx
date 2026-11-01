import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "./lib/apkg";
import { accentType, circled, isDrawable, pitchPattern } from "./lib/pitch";
import {
  formatInterval,
  loadAudio,
  previewIntervals,
  Rating,
  statusOf,
  type Grade,
  type Progress,
  type Settings,
  type Status,
} from "./lib/store";

const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: "忘了", key: "1" },
  { rating: Rating.Hard, label: "模糊", key: "2" },
  { rating: Rating.Good, label: "记得", key: "3" },
  { rating: Rating.Easy, label: "简单", key: "4" },
];

const STATUSES: { value: Status; label: string }[] = [
  { value: "new", label: "未开始" },
  { value: "learning", label: "学习中" },
  { value: "mastered", label: "已掌握" },
];

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
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onGrade: (rating: Grade) => void;
  onStatus: (status: Status) => void;
  onNote: (text: string) => void;
  onVoice: (voice: 1 | 2) => void;
  onSettings: () => void;
}

export function WordCard(props: Props) {
  const { note, index, total, progress, settings, study, tag } = props;
  const [revealed, setRevealed] = useState(!study);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef("");
  const jaVoice = useRef<SpeechSynthesisVoice | null>(null);
  const [hasJaVoice, setHasJaVoice] = useState(false);

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
    const blob = note.audio ? await loadAudio(note.audio) : undefined;
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

  useEffect(() => {
    setRevealed(!study);
    setMissing(false);
    return stop;
  }, [note.id, study, stop]);

  useEffect(() => {
    if (settings.autoplay && revealed) void play();
    // Play once per word; switching voice replays through the buttons below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, revealed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "escape") props.onClose();
      else if (key === "r") void play();
      else if (study && !revealed && (key === " " || key === "enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (study && revealed && "1234".includes(key)) {
        props.onGrade(GRADES[Number(key) - 1].rating);
      } else if (!study && key === "arrowleft") props.onPrev();
      else if (!study && key === "arrowright") props.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [play, props, revealed, study]);

  const status = statusOf(note.id, progress);
  const intervals = previewIntervals(progress.cards[note.id], settings.retention);

  return (
    <div className="overlay" onClick={props.onClose}>
      <section className="word-card" role="dialog" aria-label={note.word} onClick={(e) => e.stopPropagation()}>
        <div className="card-scroll">
          <header className="card-top">
            <span className="tag">
              <i />
              {tag}
            </span>
            <div className="card-actions">
              <button className="round" onClick={props.onSettings} aria-label="设置">⚙</button>
              <button className="round" onClick={props.onClose} aria-label="关闭">✕</button>
            </div>
          </header>

          <h1 className="headword">{note.word}</h1>

          {revealed ? (
            <>
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

              {note.pos && <p className="pos">{note.pos}</p>}
              <p className="meaning">{note.meaning}</p>
              <hr />

              <h2>学习进度</h2>
              <div className="pills">
                {STATUSES.map((s) => (
                  <button key={s.value} className={status === s.value ? "active" : ""} onClick={() => props.onStatus(s.value)}>
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
            </>
          ) : (
            <p className="prompt">先在心里读出来，再看答案</p>
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
