import type { MobileClient } from './client';
export const algorithmLanguages = ['cpp', 'python', 'javascript', 'java'] as const;
export type AlgorithmLanguage = (typeof algorithmLanguages)[number];
export const algorithmLanguageLabels: Record<AlgorithmLanguage, string> = {
  cpp: 'C++',
  python: 'Python',
  javascript: 'JavaScript',
  java: 'Java',
};
export type CodeDraft = { language: AlgorithmLanguage; code: string; revision: number; updatedAt: string };
export type CodeWorkspace = {
  problemId: string;
  starterCode: Record<AlgorithmLanguage, string>;
  draft: CodeDraft | null;
};
export type CodeEdit = { language: AlgorithmLanguage; code: string };
export type CodeState = {
  language: AlgorithmLanguage;
  codes: Record<AlgorithmLanguage, string>;
  saved: Record<AlgorithmLanguage, string>;
  draft: CodeDraft | null;
};
export function initialCodeState(workspace: CodeWorkspace): CodeState {
  const codes = { ...workspace.starterCode };
  if (workspace.draft) codes[workspace.draft.language] = workspace.draft.code;
  return { language: workspace.draft?.language ?? 'cpp', codes, saved: { ...codes }, draft: workspace.draft };
}
export function codeIsDirty(state: CodeState) {
  return algorithmLanguages.some((language) => state.codes[language] !== state.saved[language]);
}
/** Loading/saving one cloud draft must never erase another language's local input. */
export function acceptCodeDraft(state: CodeState, draft: CodeDraft, load: boolean): CodeState {
  return {
    ...state,
    draft,
    language: load ? draft.language : state.language,
    codes: load ? { ...state.codes, [draft.language]: draft.code } : state.codes,
    saved: { ...state.saved, [draft.language]: draft.code },
  };
}
export function reconcileCodeDraft(
  base: CodeDraft | null,
  intent: CodeEdit,
  current: CodeDraft | null,
): 'applied' | 'unchanged' | 'conflict' {
  if (
    current &&
    current.revision === (base?.revision ?? 0) + 1 &&
    current.language === intent.language &&
    current.code === intent.code
  )
    return 'applied';
  if (
    (!base && !current) ||
    (base &&
      current &&
      base.revision === current.revision &&
      base.language === current.language &&
      base.code === current.code)
  )
    return 'unchanged';
  return 'conflict';
}
function utf8Length(value: string) {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export function validateAlgorithmCode(code: string, execute = false) {
  if (code.length > 16000 || utf8Length(code) > 48000 || code.includes('\0'))
    throw new Error('代码最多16000字符、48000字节，不能包含空字符');
  if (execute && !code.trim()) throw new Error('请输入需要运行的代码');
  return code;
}
export function validateAlgorithmStdin(value: string) {
  if (value.length > 16000 || utf8Length(value) > 32000 || value.includes('\0'))
    throw new Error('自定义输入最多16000字符、32000字节，不能包含空字符');
  return value;
}
export type AlgorithmVerdict =
  | 'running'
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit'
  | 'memory_limit'
  | 'system_error';
export const algorithmVerdicts: Record<AlgorithmVerdict, string> = {
  running: '执行中',
  accepted: '通过',
  wrong_answer: '答案错误',
  compile_error: '编译错误',
  runtime_error: '运行错误',
  time_limit: '运行超时',
  memory_limit: '内存超限',
  system_error: '服务未完成',
};
export type CodeSubmission = {
  id: string;
  problemId: string;
  language: AlgorithmLanguage;
  code: string;
  mode: 'run' | 'submit';
  customInput: boolean;
  status: AlgorithmVerdict;
  passed: number;
  total: number;
  runtimeMs: number | null;
  memoryKb: number | null;
  compileOutput: string;
  error: string | null;
  createdAt: string;
  results: {
    index: number;
    status: AlgorithmVerdict;
    hidden: boolean;
    input?: string;
    expectedOutput?: string;
    stdout?: string;
    stderr?: string;
    runtimeMs?: number | null;
    memoryKb?: number | null;
  }[];
};
export type CodeHistory = { items: CodeSubmission[]; total: number; page: number; pageSize: number };
export type JudgeStatus = {
  judge: { available: boolean; reason: string | null; languages: { id: AlgorithmLanguage; label: string }[] };
  ai?: { available: boolean; reason: string | null; model: string };
};
export function submissionKind(row: Pick<CodeSubmission, 'mode' | 'customInput'>) {
  return row.mode === 'submit' ? '正式提交' : row.customInput ? '自定义运行' : '样例运行';
}
export function submissionVerdict(row: Pick<CodeSubmission, 'mode' | 'status'>) {
  return row.status === 'accepted' && row.mode === 'run'
    ? '运行完成（不计为通过题目）'
    : algorithmVerdicts[row.status];
}
// The server reservation lasts 65s + 30s. Unknown responses must not be replayed.
export function canRetryUnknownExecution(startedAt: number, now: number, history: CodeHistory | null) {
  return (
    now - startedAt >= 95000 &&
    !!history &&
    history.page === 1 &&
    !history.items.some((row) => row.status === 'running')
  );
}
const path = (id: string) => '/mobile/algorithms/problems/' + encodeURIComponent(id);
export const codeWorkspaceApi = {
  load: (client: MobileClient, id: string) => client.request<CodeWorkspace>(path(id) + '/workspace'),
  status: (client: MobileClient) => client.request<JudgeStatus>('/mobile/algorithms/status'),
  save: (client: MobileClient, id: string, base: CodeDraft | null, intent: CodeEdit) =>
    client.request<CodeDraft>(
      path(id) + '/draft',
      { revision: base?.revision ?? 0, ...intent, code: validateAlgorithmCode(intent.code) },
      'PUT',
    ),
  execute: (client: MobileClient, id: string, intent: CodeEdit, mode: 'run' | 'submit', stdin?: string) =>
    client.request<CodeSubmission>(
      path(id) + '/submissions',
      {
        ...intent,
        code: validateAlgorithmCode(intent.code, true),
        mode,
        ...(mode === 'run' && stdin !== undefined ? { stdin: validateAlgorithmStdin(stdin) } : {}),
      },
      'POST',
    ),
  history: (client: MobileClient, id: string, page = 1) =>
    client.request<CodeHistory>(path(id) + '/submissions?pageSize=10&page=' + page),
  submission: (client: MobileClient, id: string) =>
    client.request<CodeSubmission>('/mobile/algorithms/submissions/' + encodeURIComponent(id)),
};
