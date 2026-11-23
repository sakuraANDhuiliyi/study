import type { MobileClient } from './client';
import type { AlgorithmSummary } from './algorithms-model';
import type { AlgorithmLanguage, CodeEdit, CodeSubmission } from './algorithm-workspace-model';
export type AlgorithmAnalysis = {
  id: string;
  problemId: string;
  language: AlgorithmLanguage;
  mode: 'hint' | 'explain' | 'debug';
  status: 'pending' | 'ready' | 'failed';
  content: {
    summary: string;
    approach: string[];
    complexity: string;
    pitfalls: string[];
    suggestedCode: string;
  } | null;
  error: string | null;
  createdAt: string;
};
export type TrainingPlan = {
  id: string;
  title: string;
  description: string;
  problemIds: string[];
  problems: AlgorithmSummary[];
  total: number;
  solved: number;
  nextProblemId: string | null;
  archived: boolean;
  revision: number;
};
export type TrainingPlans = {
  items: TrainingPlan[];
  catalog: Pick<AlgorithmSummary, 'id' | 'number' | 'title' | 'difficulty' | 'tags'>[];
  limits: { maxPlans: number; maxProblems: number };
};
export type ForumPost = {
  id: string;
  scope: 'public' | 'organization';
  kind: 'question' | 'solution' | 'discussion';
  problemId: string | null;
  title: string;
  body?: string;
  excerpt?: string;
  authorLabel: string;
  revision: number;
  isOwn: boolean;
  closed: boolean;
  replyCount: number;
  createdAt: string;
};
export type ForumReply = {
  id: string;
  body: string;
  authorLabel: string;
  revision: number;
  isOwn: boolean;
  createdAt: string;
};
export type ForumPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type ForumStatus = {
  canWrite: boolean;
  canOrganization: boolean;
  limits: { maxBodyLength: number; writesPerMinute: number; writesPerDay: number };
};
export function analysisSubmission(intent: CodeEdit, selected: CodeSubmission | null) {
  return selected &&
    selected.status !== 'running' &&
    selected.language === intent.language &&
    selected.code === intent.code
    ? selected.id
    : undefined;
}
export function learningText(value: string, max: number, label: string) {
  if (!value.trim() || value.trim().length > max || value.includes('\0'))
    throw new Error(`${label}需填写1至${max}字符，不能包含空字符`);
  return value.trim();
}
const base = '/mobile/algorithms';
export const algorithmLearningApi = {
  analyses: (c: MobileClient, id: string) =>
    c.request<{ items: AlgorithmAnalysis[] }>(base + '/problems/' + encodeURIComponent(id) + '/analyses'),
  analyze: (
    c: MobileClient,
    id: string,
    intent: CodeEdit,
    mode: AlgorithmAnalysis['mode'],
    selected: CodeSubmission | null,
  ) =>
    c.request<AlgorithmAnalysis>(
      base + '/problems/' + encodeURIComponent(id) + '/analysis',
      {
        ...intent,
        mode,
        ...(mode === 'debug' && analysisSubmission(intent, selected)
          ? { submissionId: analysisSubmission(intent, selected) }
          : {}),
      },
      'POST',
    ),
  plans: (c: MobileClient) => c.request<TrainingPlans>(base + '/training-plans'),
  createPlan: (c: MobileClient, title: string, description: string, problemIds: string[]) =>
    c.request<TrainingPlan>(
      base + '/training-plans',
      { title: learningText(title, 120, '计划名称'), description, problemIds },
      'POST',
    ),
  forumStatus: (c: MobileClient) => c.request<ForumStatus>(base + '/forum/status'),
  posts: (c: MobileClient, scope: ForumPost['scope'], problemId?: string, page = 1) =>
    c.request<ForumPage<ForumPost>>(
      base +
        '/forum/posts?' +
        new URLSearchParams({
          scope,
          page: String(page),
          pageSize: '10',
          ...(problemId ? { problemId } : {}),
        }),
    ),
  post: (c: MobileClient, id: string) =>
    c.request<ForumPost>(base + '/forum/posts/' + encodeURIComponent(id)),
  replies: (c: MobileClient, id: string, page = 1) =>
    c.request<ForumPage<ForumReply>>(
      base + '/forum/posts/' + encodeURIComponent(id) + '/replies?pageSize=10&page=' + page,
    ),
  createPost: (
    c: MobileClient,
    input: {
      scope: ForumPost['scope'];
      kind: ForumPost['kind'];
      title: string;
      body: string;
      problemId?: string;
    },
  ) =>
    c.request<ForumPost>(
      base + '/forum/posts',
      {
        ...input,
        title: learningText(input.title, 160, '标题'),
        body: learningText(input.body, 15000, '正文'),
      },
      'POST',
    ),
  reply: (c: MobileClient, post: ForumPost, body: string) =>
    c.request<ForumReply>(
      base + '/forum/posts/' + encodeURIComponent(post.id) + '/replies',
      { postRevision: post.revision, body: learningText(body, 15000, '回复') },
      'POST',
    ),
};
