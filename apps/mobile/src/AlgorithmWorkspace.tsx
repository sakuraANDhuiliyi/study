import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, TextInput, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { AlgorithmAiPanel } from './AlgorithmAiPanel';
import {
  acceptCodeDraft,
  algorithmLanguageLabels,
  algorithmLanguages,
  algorithmVerdicts,
  canRetryUnknownExecution,
  codeIsDirty,
  codeWorkspaceApi,
  initialCodeState,
  reconcileCodeDraft,
  submissionKind,
  submissionVerdict,
  validateAlgorithmCode,
  validateAlgorithmStdin,
  type CodeDraft,
  type CodeEdit,
  type CodeHistory,
  type CodeState,
  type CodeSubmission,
  type JudgeStatus,
} from './algorithm-workspace-model';

const certainFailure = (error: unknown) =>
  error instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429, 503].includes(error.status);
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '请求未完成，请稍后重试。';
const codeStyle = { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, lineHeight: 20 };

export function AlgorithmWorkspace({
  client,
  problemId,
  registerLeave,
}: {
  client: MobileClient;
  problemId: string;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [state, setState] = useState<CodeState | null>(null),
    [status, setStatus] = useState<JudgeStatus | null>(null);
  const [history, setHistory] = useState<CodeHistory | null>(null),
    [result, setResult] = useState<CodeSubmission | null>(null);
  const [message, setMessage] = useState(''),
    [historyError, setHistoryError] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [historyLoading, setHistoryLoading] = useState(false);
  const [custom, setCustom] = useState(false),
    [stdin, setStdin] = useState('');
  const [conflict, setConflict] = useState<CodeDraft | null>(null),
    [unknownSave, setUnknownSave] = useState(false);
  const [unknownRun, setUnknownRun] = useState<number | null>(null),
    [retryReady, setRetryReady] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    historySequence = useRef(0),
    selection = useRef(0);
  const pending = useRef<{ base: CodeDraft | null; intent: CodeEdit } | null>(null);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const dirty = !!state && codeIsDirty(state);
  const refreshStatus = async () => {
    try {
      const next = await codeWorkspaceApi.status(client);
      if (alive()) setStatus(next);
    } catch (error) {
      if (alive()) setMessage(errorMessage(error));
    }
  };
  const load = async () => {
    if (flight.current) return;
    setLoading(true);
    setMessage('');
    try {
      const [workspace, availability, records] = await Promise.all([
        codeWorkspaceApi.load(client, problemId),
        codeWorkspaceApi.status(client),
        codeWorkspaceApi.history(client, problemId),
      ]);
      if (!alive()) return;
      setState((old) => old ?? initialCodeState(workspace));
      setStatus(availability);
      setHistory(records);
    } catch (error) {
      if (alive()) setMessage(errorMessage(error));
    } finally {
      if (alive()) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = client.onSessionInvalidated(() => {
      mounted.current = false;
      selection.current++;
      historySequence.current++;
      pending.current = null;
      setState(null);
      setHistory(null);
      setResult(null);
      setStdin('');
      setConflict(null);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [client, problemId]);
  useEffect(() => {
    registerLeave(
      dirty || busy || unknownSave || unknownRun !== null
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('请求正在处理中', '请等待本次草稿或判题请求结束后再离开。');
              return;
            }
            Alert.alert(
              '离开代码工作区？',
              unknownSave || unknownRun !== null
                ? '请求结果尚未确认。重新进入后请先查看云端草稿和提交记录，不要直接重复提交。'
                : '未保存的代码只保留在当前页面，离开会丢失。其他语言的未保存代码也会丢失。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [dirty, busy, unknownSave, unknownRun, registerLeave]);
  const refreshHistory = async (page = 1) => {
    const sequence = ++historySequence.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const records = await codeWorkspaceApi.history(client, problemId, page);
      if (!alive() || sequence !== historySequence.current) return;
      setHistory(records);
      setRetryReady(unknownRun !== null && canRetryUnknownExecution(unknownRun, Date.now(), records));
    } catch (error) {
      if (alive() && sequence === historySequence.current) {
        setHistoryError(errorMessage(error));
        setRetryReady(false);
      }
    } finally {
      if (alive() && sequence === historySequence.current) setHistoryLoading(false);
    }
  };
  const inspect = async (id: string) => {
    const sequence = ++selection.current;
    setResult(null);
    setMessage('正在读取本人提交记录…');
    try {
      const record = await codeWorkspaceApi.submission(client, id);
      if (!alive() || sequence !== selection.current) return;
      if (record.problemId !== problemId) throw new Error('提交记录不属于当前题目');
      setResult(record);
      setMessage('');
    } catch (error) {
      if (alive() && sequence === selection.current) setMessage(errorMessage(error));
    }
  };
  useEffect(() => {
    if (result?.status !== 'running') return;
    let active = true,
      polling = false;
    const selected = selection.current;
    const timer = setInterval(async () => {
      if (polling || AppState.currentState !== 'active') return;
      polling = true;
      try {
        const next = await codeWorkspaceApi.submission(client, result.id);
        if (!active || !alive() || selected !== selection.current || next.problemId !== problemId) return;
        setResult(next);
        if (next.status !== 'running') void refreshHistory();
      } catch (error) {
        if (active && alive() && selected === selection.current) setMessage(errorMessage(error));
      } finally {
        polling = false;
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [result?.id, result?.status]);
  const save = async () => {
    if (!state || flight.current || conflict || unknownSave) return;
    const intent = { language: state.language, code: state.codes[state.language] };
    try {
      validateAlgorithmCode(intent.code);
    } catch (error) {
      setMessage(errorMessage(error));
      return;
    }
    const request = { base: state.draft, intent };
    pending.current = request;
    flight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const draft = await codeWorkspaceApi.save(client, problemId, request.base, intent);
      if (!alive()) return;
      setState((old) => (old ? acceptCodeDraft(old, draft, false) : old));
      pending.current = null;
      setMessage('当前语言草稿已保存，与网站共享版本。');
    } catch (error) {
      if (!alive()) return;
      if (certainFailure(error)) {
        pending.current = null;
        setMessage(errorMessage(error));
        if (error instanceof MobileApiError && error.status === 409) {
          // A failed read never authorizes an overwrite: keep the unknown gate closed.
          setUnknownSave(true);
          pending.current = request;
        }
      } else {
        setUnknownSave(true);
        setMessage('保存结果尚未确认。请先核对云端草稿，不会自动重发。');
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const reconcile = async () => {
    if (flight.current || !pending.current) return;
    const request = pending.current;
    flight.current = true;
    setBusy(true);
    try {
      const current = (await codeWorkspaceApi.load(client, problemId)).draft;
      if (!alive()) return;
      const resolution = reconcileCodeDraft(request.base, request.intent, current);
      if (resolution === 'applied' && current) {
        setState((old) => (old ? acceptCodeDraft(old, current, false) : old));
        setMessage('已核对：草稿已保存，没有重复写入。');
      } else if (resolution === 'unchanged') setMessage('云端仍是原版本，当前代码已保留，需要时可重新保存。');
      else {
        setConflict(current);
        setMessage('云端草稿已更新。当前代码已保留；请比较后决定加载云端，或保留本地并使用新版本保存。');
        if (!current) return;
      }
      setUnknownSave(false);
      pending.current = null;
    } catch (error) {
      if (alive()) setMessage(errorMessage(error));
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const resolveConflict = (loadCloud: boolean) => {
    if (!conflict || busy) return;
    Alert.alert(
      loadCloud ? '加载云端代码？' : '保留本地代码？',
      loadCloud
        ? '会替换云端草稿所属语言的本地代码。其他语言的输入保留。'
        : '确认已比较云端内容后使用其最新版本。此操作不写入，之后请自行点击保存草稿。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认',
          onPress: () => {
            setState((old) =>
              old ? (loadCloud ? acceptCodeDraft(old, conflict, true) : { ...old, draft: conflict }) : old,
            );
            setConflict(null);
            setMessage(loadCloud ? '已加载云端代码。' : '本地代码已保留，尚未写入云端。');
          },
        },
      ],
    );
  };
  const execute = async (mode: 'run' | 'submit') => {
    if (!state || flight.current || unknownRun !== null || result?.status === 'running') return;
    const intent = { language: state.language, code: state.codes[state.language] };
    const input = mode === 'run' && custom ? stdin : undefined;
    try {
      validateAlgorithmCode(intent.code, true);
      if (input !== undefined) validateAlgorithmStdin(input);
    } catch (error) {
      setMessage(errorMessage(error));
      return;
    }
    const sequence = ++selection.current,
      startedAt = Date.now();
    flight.current = true;
    setBusy(true);
    setMessage('正在通过隔离判题服务执行代码…');
    setResult(null);
    try {
      const record = await codeWorkspaceApi.execute(client, problemId, intent, mode, input);
      if (!alive()) return;
      if (sequence === selection.current) {
        setResult(record);
        setMessage('');
      }
      void refreshHistory();
    } catch (error) {
      if (!alive()) return;
      if (!certainFailure(error)) {
        setUnknownRun(startedAt);
        setRetryReady(false);
        setMessage('执行结果尚未确认，代码可能已经提交。请刷新本人提交记录核对；不会自动重发。');
      } else if (sequence === selection.current) setMessage(errorMessage(error));
      void refreshHistory();
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  const restore = (record: CodeSubmission) =>
    Alert.alert(
      '恢复历史代码？',
      `替换当前 ${algorithmLanguageLabels[record.language]} 代码，其他语言输入保留。不会自动保存或提交。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认恢复',
          onPress: () => {
            if (alive())
              setState((old) =>
                old
                  ? {
                      ...old,
                      language: record.language,
                      codes: { ...old.codes, [record.language]: record.code },
                    }
                  : old,
              );
          },
        },
      ],
    );
  const runnable =
    !!state &&
    status?.judge.available &&
    status.judge.languages.some((language) => language.id === state.language) &&
    !busy &&
    unknownRun === null &&
    result?.status !== 'running';
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>代码工作区</Text>
      <AButton title="刷新执行与AI服务状态" secondary disabled={busy} onPress={() => void refreshStatus()} />
      <Text style={a.muted}>
        代码在隔离判题服务运行。每道题共用一份云端草稿；切换语言会保留本页输入，离开前请保存需要保留的版本。
      </Text>
      {loading && <Text style={a.muted}>正在读取私有草稿和判题状态…</Text>}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      {!state && !loading && <AButton title="重新加载代码工作区" onPress={() => void load()} />}
      {state && (
        <>
          <View style={a.row}>
            {algorithmLanguages.map((language) => (
              <AButton
                key={language}
                title={algorithmLanguageLabels[language]}
                secondary={state.language !== language}
                disabled={busy}
                onPress={() => setState((old) => (old ? { ...old, language } : old))}
              />
            ))}
          </View>
          <Text style={a.muted}>
            {state.codes[state.language].length} / 16000 字符 ·{' '}
            {state.draft
              ? `云端版本 ${state.draft.revision}（${algorithmLanguageLabels[state.draft.language]}）`
              : '尚无云端草稿'}
            {dirty ? ' · 本页含未保存代码' : ''}
          </Text>
          <TextInput
            accessibilityLabel="算法代码编辑器"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            style={[a.input, codeStyle, { minHeight: 280 }]}
            value={state.codes[state.language]}
            maxLength={16000}
            editable={!busy}
            onChangeText={(code) =>
              setState((old) => (old ? { ...old, codes: { ...old.codes, [old.language]: code } } : old))
            }
          />
          <AButton
            title="保存当前语言草稿"
            disabled={busy || unknownSave || !!conflict}
            onPress={() => void save()}
          />
          {unknownSave && (
            <AButton title="只读核对云端草稿" disabled={busy} onPress={() => void reconcile()} />
          )}
          {conflict && (
            <View style={a.child}>
              <Text style={a.subtitle}>
                云端 {algorithmLanguageLabels[conflict.language]} 草稿 · 版本 {conflict.revision}
              </Text>
              <Text selectable style={[a.body, codeStyle]}>
                {conflict.code || '（空代码）'}
              </Text>
              <AButton title="加载云端代码" disabled={busy} onPress={() => resolveConflict(true)} />
              <AButton
                title="比较后保留本地代码"
                disabled={busy}
                secondary
                onPress={() => resolveConflict(false)}
              />
            </View>
          )}
          {status && !status.judge.available && (
            <Text style={a.notice}>{status.judge.reason || '判题服务暂不可用，请联系管理员配置。'}</Text>
          )}
          <AButton
            title={custom ? '改为运行公开样例' : '使用自定义输入'}
            secondary
            disabled={busy}
            onPress={() => setCustom((value) => !value)}
          />
          {custom && (
            <TextInput
              accessibilityLabel="算法自定义输入"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              style={[a.input, a.textarea, codeStyle]}
              value={stdin}
              onChangeText={setStdin}
              maxLength={16000}
              editable={!busy}
            />
          )}
          <Text style={a.muted}>
            运行样例和自定义输入只用于调试；只有正式提交全部通过才计为通过题目。运行与提交不会自动保存草稿。
          </Text>
          <View style={a.row}>
            <AButton
              title={custom ? '运行自定义输入' : '运行公开样例'}
              disabled={!runnable}
              onPress={() => void execute('run')}
            />
            <AButton
              title="正式提交代码"
              disabled={!runnable}
              onPress={() =>
                Alert.alert(
                  '正式提交当前代码？',
                  '将当前语言的代码快照提交到全部测试用例。隐藏用例内容不会显示。',
                  [
                    { text: '取消', style: 'cancel' },
                    { text: '确认正式提交', onPress: () => void execute('submit') },
                  ],
                )
              }
            />
          </View>
          {unknownRun !== null && (
            <View style={a.child}>
              <Text style={a.body}>
                请核对下面的提交时间、代码和执行类型。至少等待95秒并刷新首页记录，确认没有仍在执行的请求后，才可手动再次提交。
              </Text>
              <AButton
                title="已核对记录，解除未知结果保护"
                disabled={!retryReady || historyLoading}
                secondary
                onPress={() =>
                  Alert.alert('确认已核对？', '已有提交仍保留在历史中。解除保护不会自动执行代码。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '确认解除',
                      onPress: () => {
                        setUnknownRun(null);
                        setRetryReady(false);
                        setMessage('已解除保护；如确需再次执行，请手动运行或提交。');
                      },
                    },
                  ])
                }
              />
            </View>
          )}
        </>
      )}
      {state && (
        <AlgorithmAiPanel
          client={client}
          problemId={problemId}
          intent={{ language: state.language, code: state.codes[state.language] }}
          submission={result}
          availability={status?.ai}
        />
      )}
      <Text style={a.subtitle}>本人运行与提交记录</Text>
      <AButton
        title="刷新本人提交记录"
        secondary
        disabled={historyLoading}
        onPress={() => void refreshHistory()}
      />
      {historyLoading && <Text style={a.muted}>正在核对提交记录…</Text>}
      {historyError ? <Text style={a.error}>{historyError}</Text> : null}
      {history && !historyError && (
        <>
          <Text style={a.muted}>
            共 {history.total} 次，第 {history.page} 页
          </Text>
          {history.items.map((record) => (
            <View key={record.id} style={a.child}>
              <Text style={a.body}>
                {submissionKind(record)} · {algorithmLanguageLabels[record.language]} ·{' '}
                {submissionVerdict(record)}
              </Text>
              <Text style={a.muted}>{new Date(record.createdAt).toLocaleString()}</Text>
              <AButton title={'查看提交 ' + record.id} secondary onPress={() => void inspect(record.id)} />
            </View>
          ))}
          {!history.total && <Text style={a.body}>还没有运行或提交记录。</Text>}
          <View style={a.row}>
            <AButton
              title="上一页提交记录"
              disabled={historyLoading || history.page <= 1}
              secondary
              onPress={() => void refreshHistory(history.page - 1)}
            />
            <AButton
              title="下一页提交记录"
              disabled={historyLoading || history.page * history.pageSize >= history.total}
              secondary
              onPress={() => void refreshHistory(history.page + 1)}
            />
          </View>
        </>
      )}
      {result && (
        <View style={a.child}>
          <Text style={a.subtitle}>
            {submissionKind(result)}：{submissionVerdict(result)}
          </Text>
          <Text style={a.muted}>
            {new Date(result.createdAt).toLocaleString()} · {algorithmLanguageLabels[result.language]}
            {result.customInput ? '' : ` · ${result.passed}/${result.total} 用例`} · {result.runtimeMs ?? '—'}{' '}
            ms / {result.memoryKb ?? '—'} KiB
          </Text>
          {result.error && <Text style={a.error}>{result.error}</Text>}
          {result.compileOutput ? (
            <Text selectable style={[a.body, codeStyle]}>
              {result.compileOutput}
            </Text>
          ) : null}
          {result.results.map((row) => (
            <View key={row.index} style={a.child}>
              <Text style={a.body}>
                用例 {row.index} · {row.hidden ? '隐藏用例 · ' : ''}
                {algorithmVerdicts[row.status]}
              </Text>
              {!row.hidden && (
                <>
                  <Text selectable style={[a.body, codeStyle]}>
                    输入：{'\n'}
                    {row.input}
                  </Text>
                  {row.expectedOutput !== undefined && (
                    <Text selectable style={[a.body, codeStyle]}>
                      预期输出：{'\n'}
                      {row.expectedOutput}
                    </Text>
                  )}
                  <Text selectable style={[a.body, codeStyle]}>
                    实际输出：{'\n'}
                    {row.stdout}
                  </Text>
                  {row.stderr ? (
                    <Text selectable style={[a.error, codeStyle]}>
                      {row.stderr}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ))}
          <Text style={a.subtitle}>此次代码快照（只读）</Text>
          <Text selectable style={[a.body, codeStyle]}>
            {result.code || '（空代码）'}
          </Text>
          <AButton
            title="恢复此次代码到编辑器"
            secondary
            disabled={busy || !state}
            onPress={() => restore(result)}
          />
        </View>
      )}
    </View>
  );
}
