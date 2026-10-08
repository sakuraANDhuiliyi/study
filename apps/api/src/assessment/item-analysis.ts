import { autoScore, type QuestionData } from './scoring';

export interface AnalysisAnswer {
  value: unknown;
  scoreCents: number | null;
  graded: boolean;
}

/** Empty slots are not responses; false and numeric zero are meaningful answers. */
export function hasResponse(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasResponse);
  if (typeof value === 'object') return Object.values(value).some(hasResponse);
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

const percent = (count: number, total: number) => (total ? Math.round((count / total) * 10000) / 100 : null);

/** Incremental aggregation keeps memory bounded independently of the number of responses. */
export function itemAccumulator(question: QuestionData, participantCount: number) {
  const objective = ['single', 'multiple', 'boolean', 'blank'].includes(question.type);
  const options = (
    question.type === 'boolean'
      ? [
          { id: 'true', text: '正确' },
          { id: 'false', text: '错误' },
        ]
      : ['single', 'multiple'].includes(question.type)
        ? question.options
        : []
  ).map((option) => ({ ...option, count: 0 }));
  let answeredCount = 0,
    gradedCount = 0,
    correctCount = 0,
    scoreSumCents = 0,
    invalidResponseCount = 0;
  return {
    add(answer: AnalysisAnswer) {
      if (hasResponse(answer.value)) {
        answeredCount++;
        if (options.length) {
          const values =
            question.type === 'multiple' ? (Array.isArray(answer.value) ? answer.value : []) : [answer.value];
          const validValue = (value: unknown): value is string | boolean =>
            typeof value === 'string' || (question.type === 'boolean' && typeof value === 'boolean');
          const selected = new Set(
            values
              .filter(validValue)
              .map((value) => (typeof value === 'string' ? value : value ? 'true' : 'false')),
          );
          if (
            values.some((value) => !validValue(value)) ||
            !selected.size ||
            [...selected].some((id) => !options.some((o) => o.id === id))
          )
            invalidResponseCount++;
          for (const option of options) if (selected.has(option.id)) option.count++;
        }
      }
      // A zero-weight item still has a right answer; unit weighting also excludes partial credit.
      if (objective && autoScore({ ...question, scoreCents: 1 }, answer.value) === 1) correctCount++;
      if (answer.graded && answer.scoreCents !== null && Number.isFinite(answer.scoreCents)) {
        gradedCount++;
        scoreSumCents += answer.scoreCents;
      }
    },
    result() {
      return {
        participantCount,
        answeredCount,
        unansweredCount: participantCount - answeredCount,
        gradedCount,
        pendingCount: participantCount - gradedCount,
        correctCount: objective ? correctCount : null,
        correctRate: objective ? percent(correctCount, participantCount) : null,
        averageScoreCents: gradedCount ? scoreSumCents / gradedCount : null,
        scoreRate: question.scoreCents > 0 ? percent(scoreSumCents, gradedCount * question.scoreCents) : null,
        invalidResponseCount,
        options: options.map((option) => ({ ...option, percent: percent(option.count, participantCount) })),
      };
    },
  };
}
