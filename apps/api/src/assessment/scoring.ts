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

/** Validate against the immutable task snapshot, including composite child IDs. */
export function validAnswerValue(question: QuestionData, value: unknown): boolean {
  if (value === null) return true; // Explicitly clearing an answer is allowed.
  if (question.type === 'single')
    return (
      typeof value === 'string' && (value === '' || question.options.some((option) => option.id === value))
    );
  if (question.type === 'boolean') return [true, false, 'true', 'false', ''].includes(value as boolean);
  if (question.type === 'multiple')
    return (
      Array.isArray(value) &&
      value.length <= question.options.length &&
      new Set(value).size === value.length &&
      value.every(
        (option) => typeof option === 'string' && question.options.some((item) => item.id === option),
      )
    );
  if (question.type === 'blank')
    return (
      Array.isArray(value) &&
      Array.isArray(question.answer) &&
      value.length <= question.answer.length &&
      value.every((answer) => typeof answer === 'string')
    );
  if (question.type === 'short') return typeof value === 'string';
  if (question.type === 'composite')
    return (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value as Record<string, unknown>).every(([id, answer]) => {
        const child = question.children.find((item) => item.id === id);
        return child !== undefined && child.type !== 'composite' && validAnswerValue(child, answer);
      })
    );
  return false;
}

export function normalizeBlank(value: unknown, rules: QuestionData['rules'] = {}): string {
  let result = (typeof value === 'string' ? value : '').normalize('NFKC');
  if (rules.trim !== false) result = result.trim();
  if (rules.collapseWhitespace !== false) result = result.replace(/\s+/g, ' ');
  return rules.caseSensitive ? result : result.toLocaleLowerCase('en-US');
}

/** Null means human marking is required; it must never become a released zero. */
export function autoScore(question: QuestionData, value: unknown): number | null {
  const maximum = question.scoreCents;
  if (question.type === 'short' || question.type === 'composite') return null;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    !question.rules ||
    typeof question.rules !== 'object' ||
    Array.isArray(question.rules)
  )
    return null;
  const optionIds = Array.isArray(question.options) ? question.options.map((option) => option?.id) : [];
  const validOptions =
    optionIds.length >= 2 &&
    optionIds.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(optionIds).size === optionIds.length;
  if (question.type === 'single') {
    if (!validOptions || typeof question.answer !== 'string' || !optionIds.includes(question.answer))
      return null;
    return typeof value === 'string' && value === question.answer ? maximum : 0;
  }
  if (question.type === 'boolean') {
    const expected =
      question.answer === true || question.answer === 'true'
        ? true
        : question.answer === false || question.answer === 'false'
          ? false
          : undefined;
    if (expected === undefined) return null;
    const given =
      value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
    return given !== undefined && given === expected ? maximum : 0;
  }
  if (question.type === 'multiple') {
    if (
      !Array.isArray(question.answer) ||
      !question.answer.length ||
      !validOptions ||
      question.answer.some((answer) => typeof answer !== 'string' || !optionIds.includes(answer)) ||
      new Set(question.answer).size !== question.answer.length
    )
      return null;
    const expected = new Set(question.answer as string[]);
    if (!Array.isArray(value) || value.some((answer) => typeof answer !== 'string')) return 0;
    const given = new Set(value as string[]);
    if (!given.size || [...given].some((option) => !expected.has(option))) return 0;
    if (given.size === expected.size) return maximum;
    return question.rules.partialCredit ? Math.floor((maximum * given.size) / expected.size) : 0;
  }
  if (question.type === 'blank') {
    if (
      !Array.isArray(question.answer) ||
      !question.answer.length ||
      question.answer.some(
        (answers) =>
          !Array.isArray(answers) || !answers.length || answers.some((answer) => typeof answer !== 'string'),
      )
    )
      return null;
    const accepted = question.answer as string[][];
    if (accepted.some((answers) => answers.some((answer) => !answer.trim()))) return null;
    const given = Array.isArray(value) ? value : [value];
    if (given.some((answer) => typeof answer !== 'string')) return 0;
    if (given.length !== accepted.length) return 0;
    const correct = accepted.filter((answers, index) =>
      answers.some(
        (answer) => normalizeBlank(answer, question.rules) === normalizeBlank(given[index], question.rules),
      ),
    ).length;
    return Math.floor((maximum * correct) / accepted.length);
  }
  return null; // Damaged historical snapshots need human marking, never a released zero.
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
