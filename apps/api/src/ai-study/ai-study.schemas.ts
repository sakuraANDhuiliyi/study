import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !v.includes('\0'), '不能包含空字符');
export const createAiReportInput = z
  .object({
    mistakeIds: z
      .array(text(100))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, '不能重复选择错题'),
    reflection: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => !v.includes('\0'))
      .default(''),
  })
  .strict();
export const searchAiReportInput = z.object({ query: text(300) }).strict();
export const aiReportQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export const aiExportQuery = z.object({ format: z.enum(['md', 'json']).default('md') }).strict();

export interface AiMistake {
  mistakeId: string;
  questionId: string;
  questionVersionId: string;
  courseId: string;
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
  scoreCents: number | null;
  maxScoreCents: number;
}

export const aiAnalysisSchema = z
  .object({
    summary: text(4000),
    patterns: z
      .array(
        z
          .object({
            label: text(120),
            evidence: text(2000),
            advice: text(2000),
            mistakeIds: z.array(text(100)).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    items: z
      .array(
        z
          .object({
            mistakeId: text(100),
            diagnosis: text(2000),
            reasoning: text(4000),
            correction: text(4000),
            knowledgePoints: z.array(text(150)).max(10),
            confidence: z.enum(['low', 'medium', 'high']),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    reviewPlan: z.array(text(1000)).min(1).max(10),
    searchQueries: z.array(text(300)).min(1).max(6),
  })
  .strict();
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
export interface AiSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
}
export interface AiCitation {
  start: number;
  end: number;
  sourceId: string;
}
export interface AiSearchResult {
  query: string;
  summary: string;
  sources: AiSource[];
  citations: AiCitation[];
  searchedAt: string;
  provider: 'openai' | 'tavily';
}
export interface AiStudyStatus {
  analysis: { available: boolean; reason: string };
  search: { available: boolean; reason: string };
  model: string;
  searchProvider: string;
  limits: { maxMistakes: number; dailyRequests: number; maxDownloadMb: number };
}
