export const aiStudyRoot = '/mobile/ai-study';
export type AiStudyStatus = {
  analysis: { available: boolean; reason: string };
  search: { available: boolean; reason: string };
  model: string;
  searchProvider: string;
  limits: { maxMistakes: number; dailyRequests: number; maxDownloadMb: number };
};
export type AiReportSummary = {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
  summary: string;
  error: string | null;
  mistakeCount: number;
};
export type AiReport = {
  id: string;
  status: AiReportSummary['status'];
  createdAt: string;
  updatedAt: string;
  error: string | null;
  reflection: string;
  mistakes: {
    mistakeId: string;
    courseTitle: string;
    stem: string;
    type: string;
    options: unknown;
    studentAnswer: unknown;
    correctAnswer: unknown;
    explanation: string;
    knowledgePoints: string[];
    wrongCount: number;
    answeredAt: string;
  }[];
  analysis: {
    summary: string;
    patterns: { label: string; evidence: string; advice: string; mistakeIds: string[] }[];
    items: {
      mistakeId: string;
      diagnosis: string;
      reasoning: string;
      correction: string;
      knowledgePoints: string[];
      confidence: 'low' | 'medium' | 'high';
    }[];
    reviewPlan: string[];
    searchQueries: string[];
  } | null;
  search: {
    query: string;
    summary: string;
    sources: { id: string; title: string; url: string; snippet: string }[];
    citations: { start: number; end: number; sourceId: string }[];
    searchedAt: string;
    provider: string;
  } | null;
  searchError?: string;
};
export function aiAnswerText(value: unknown): string {
  return value == null
    ? '未作答'
    : typeof value === 'string'
      ? value
      : typeof value === 'boolean'
        ? value
          ? '正确'
          : '错误'
        : JSON.stringify(value, null, 2);
}
export function aiSourceUrl(value: string) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export function aiCitationText(search: NonNullable<AiReport['search']>, sourceId: string) {
  return search.citations
    .filter(
      (c) =>
        c.sourceId === sourceId &&
        Number.isInteger(c.start) &&
        Number.isInteger(c.end) &&
        c.start >= 0 &&
        c.end > c.start &&
        c.end <= search.summary.length,
    )
    .map((c) => search.summary.slice(c.start, c.end));
}
