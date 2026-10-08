/** Assessment scoring uses integer hundredths of a point everywhere. */
export interface QuestionData {
  id: string;
  questionId: string;
  version: number;
  type: string;
  stem: string;
  options: { id: string; text: string }[];
  answer: unknown;
  explanation: string;
  rules: { partialCredit?: boolean; caseSensitive?: boolean; trim?: boolean; collapseWhitespace?: boolean };
  scoreCents: number;
  difficulty: number;
  knowledgePoints: string[];
  tags: string[];
  children: QuestionData[];
}

export function normalizeBlank(value: unknown, rules: QuestionData['rules'] = {}): string {
  let result = String(value ?? '').normalize('NFKC');
  if (rules.trim !== false) result = result.trim();
  if (rules.collapseWhitespace !== false) result = result.replace(/\s+/g, ' ');
  return rules.caseSensitive ? result : result.toLocaleLowerCase('en-US');
}

/** Null means human marking is required; it must never become a released zero. */
export function autoScore(question: QuestionData, value: unknown): number | null {
  const maximum = question.scoreCents;
  if (question.type === 'short' || question.type === 'composite') return null;
  if (question.type === 'single' || question.type === 'boolean') {
    return value !== undefined && value !== null && String(value) === String(question.answer) ? maximum : 0;
  }
  if (question.type === 'multiple') {
    const expected = new Set((question.answer as unknown[]).map(String));
    const given = new Set(Array.isArray(value) ? value.map(String) : []);
    if (!given.size || [...given].some((option) => !expected.has(option))) return 0;
    if (given.size === expected.size) return maximum;
    return question.rules.partialCredit ? Math.floor((maximum * given.size) / expected.size) : 0;
  }
  if (question.type === 'blank') {
    const accepted = question.answer as string[][];
    const given = Array.isArray(value) ? value : [value];
    if (given.length !== accepted.length) return 0;
    const correct = accepted.filter((answers, index) =>
      answers.some(
        (answer) => normalizeBlank(answer, question.rules) === normalizeBlank(given[index], question.rules),
      ),
    ).length;
    return Math.floor((maximum * correct) / accepted.length);
  }
  throw new Error(`Unsupported question type: ${question.type}`);
}

/** This explicit whitelist is also applied recursively to composite questions. */
export function publicQuestion(
  question: QuestionData,
  answers = false,
  explanations = false,
): Record<string, unknown> {
  return {
    id: question.id,
    questionId: question.questionId,
    version: question.version,
    type: question.type,
    stem: question.stem,
    options: question.options,
    scoreCents: question.scoreCents,
    difficulty: question.difficulty,
    knowledgePoints: question.knowledgePoints,
    tags: question.tags,
    children: (question.children || []).map((child) => publicQuestion(child, answers, explanations)),
    ...(answers ? { answer: question.answer } : {}),
    ...(explanations ? { explanation: question.explanation } : {}),
  };
}

export function personalDeadline(
  startedAt: Date,
  durationMinutes: number,
  endsAt: Date,
  extension?: Date | null,
): Date {
  if (extension) return new Date(Math.max(startedAt.getTime(), extension.getTime()));
  return new Date(Math.min(startedAt.getTime() + durationMinutes * 60000, endsAt.getTime()));
}

export function paginate(input: { page?: unknown; pageSize?: unknown }) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function shuffled<T>(values: T[], random: () => number = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] = [result[selected]!, result[index]!];
  }
  return result;
}
