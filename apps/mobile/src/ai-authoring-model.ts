export const authoringRoot = '/mobile/ai-authoring';
export const authoringTypeLabels = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  blank: '填空题',
  short: '简答题',
};
export type AuthoringType = keyof typeof authoringTypeLabels;
export type AuthoringQuestion = {
  type: AuthoringType;
  stem: string;
  options: { id: string; text: string }[];
  answer: string[];
  explanation: string;
  knowledgePoints: string[];
  scoreCents: number;
  difficulty: number;
};
export type AuthoringDraft = {
  id: string;
  mode: 'questions' | 'paper';
  courseId: string;
  chapterId: string | null;
  title: string;
  status: 'pending' | 'ready' | 'failed' | 'saved';
  revision: number;
  questions: AuthoringQuestion[];
  error: string | null;
  model: string;
  createdAt: string;
  savedQuestionIds: string[];
  savedPaperId: string | null;
};
export type AuthoringStatus = {
  available: boolean;
  canCreatePaper: boolean;
  reason: string;
  model: string;
  limits: { maxQuestions: number; dailyRequests: number };
};
export type AuthoringQuestionEdit = Omit<
  AuthoringQuestion,
  'scoreCents' | 'difficulty' | 'knowledgePoints'
> & { scoreText: string; difficultyText: string; knowledgeText: string; answerText: string };
export const authoringLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
export function editAuthoringQuestion(q: AuthoringQuestion): AuthoringQuestionEdit {
  return {
    ...q,
    options: q.options.map((o) => ({ ...o })),
    answer: [...q.answer],
    scoreText: String(q.scoreCents / 100),
    difficultyText: String(q.difficulty),
    knowledgeText: q.knowledgePoints.join('\n'),
    answerText: q.answer.join('\n'),
  };
}
export function commitAuthoringQuestions(rows: AuthoringQuestionEdit[]): AuthoringQuestion[] {
  if (!rows.length || rows.length > 10) throw new Error('请保留1至10道题目');
  const result = rows.map((row, i) => {
    const score = Number(row.scoreText),
      difficulty = Number(row.difficultyText),
      answer =
        row.type === 'short'
          ? [row.answerText.trim()]
          : row.type === 'blank'
            ? authoringLines(row.answerText)
            : row.answer;
    if (!row.stem.trim() || !row.explanation.trim()) throw new Error(`第${i + 1}题需要题干与解析`);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(row.scoreText) ||
      !Number.isFinite(score) ||
      score < 0.01 ||
      score > 10000 ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 5
    )
      throw new Error(`第${i + 1}题分值应为0.01至10000分，难度为1至5`);
    const knowledgePoints = authoringLines(row.knowledgeText);
    if (!knowledgePoints.length || knowledgePoints.length > 20)
      throw new Error(`第${i + 1}题需要1至20个知识点`);
    const options = ['single', 'multiple'].includes(row.type)
      ? row.options.map((o) => ({ id: o.id, text: o.text.trim() }))
      : [];
    if (
      options.length &&
      (options.length < 2 ||
        options.some((o) => !o.text) ||
        new Set(options.map((o) => o.text)).size !== options.length)
    )
      throw new Error(`第${i + 1}题至少需要两个不同的完整选项`);
    if (
      ['single', 'multiple'].includes(row.type) &&
      (options.length < 2 ||
        !answer.length ||
        answer.some((a) => !options.some((o) => o.id === a)) ||
        (row.type === 'single' ? answer.length !== 1 : answer.length < 2))
    )
      throw new Error(`第${i + 1}题请选择有效的正确答案`);
    if (row.type === 'boolean' && (answer.length !== 1 || !['true', 'false'].includes(answer[0])))
      throw new Error(`第${i + 1}题请选择正确或错误`);
    if (
      !answer.length ||
      answer.some((a) => !a.trim()) ||
      (row.type === 'blank' && (row.stem.match(/_{3,}/g) || []).length !== answer.length)
    )
      throw new Error(`第${i + 1}题答案与空位不匹配`);
    return {
      type: row.type,
      stem: row.stem.trim(),
      options,
      answer,
      explanation: row.explanation.trim(),
      knowledgePoints,
      scoreCents: Math.round(score * 100),
      difficulty,
    };
  });
  if (new Set(result.map((q) => q.stem.replace(/\s+/g, '').normalize('NFKC'))).size !== result.length)
    throw new Error('不能保存重复题干');
  return result;
}
