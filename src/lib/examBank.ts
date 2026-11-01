export type ExamType = "kanji" | "context" | "synonym" | "usage";

export interface ExamItem {
  type: ExamType;
  word: string;
  /** `{text}` marks the underlined part. Usage questions have no stem beyond the word. */
  stem: string;
  /** The first option is the answer; options are shuffled when shown. */
  options: string[];
}

/** Layout of the N1 vocabulary section, in exam order. */
export const EXAM_SECTIONS: { type: ExamType; title: string; rule: string; count: number }[] = [
  { type: "kanji", title: "問題1 漢字読み", rule: "＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。", count: 6 },
  { type: "context", title: "問題2 文脈規定", rule: "（　　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。", count: 7 },
  { type: "synonym", title: "問題3 言い換え類義", rule: "＿＿の言葉に意味が最も近いものを、1・2・3・4から一つ選びなさい。", count: 6 },
  { type: "usage", title: "問題4 用法", rule: "次の言葉の使い方として最もよいものを、1・2・3・4から一つ選びなさい。", count: 6 },
];
