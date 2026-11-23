import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton, RichText } from './assignment-ui';
import { AcademicChoice, AcademicQuery, useAcademicLeave, useAcademicLive } from './academic-ui';
import type { CollectionList, CollectionRow } from './collections-model';
import {
  aiStudyRoot,
  aiAnswerText,
  aiCitationText,
  aiSourceUrl,
  type AiReport,
  type AiReportSummary,
  type AiStudyStatus,
} from './ai-study-model';
import { shareAiStudyFile } from './ai-study-files';

export function AiStudyHome({
  client,
  openReport,
  registerLeave,
  courseId,
  initialTab = 'new',
}: {
  client: MobileClient;
  openReport(id: string): void;
  registerLeave(guard: LeaveGuard): void;
  courseId?: string;
  initialTab?: 'new' | 'history';
}) {
  const [tab, setTab] = useState<'new' | 'history'>(initialTab),
    [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1);
  const status = useResource<AiStudyStatus>(client, aiStudyRoot + '/status'),
    mistakes = useResource<CollectionList>(
      client,
      '/mobile/collections/mistakes?' +
        new URLSearchParams({ page: String(page), pageSize: '10', ...(courseId ? { courseId } : {}) }),
    ),
    history = useResource<{ items: AiReportSummary[]; total: number }>(
      client,
      aiStudyRoot + '/reports?page=' + historyPage + '&pageSize=10',
      30000,
    );
  const [selected, setSelected] = useState<Record<string, CollectionRow>>({}),
    [reflection, setReflection] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const live = useAcademicLive(client),
    flight = useRef(false);
  const max = Math.min(10, status.data?.limits.maxMistakes || 10),
    count = Object.keys(selected).length;
  useAcademicLeave(registerLeave, count > 0 || !!reflection.trim() || uncertain, busy);
  const create = () =>
    Alert.alert(
      '生成本人的错题复盘？',
      '所选题目、本人作答和补充思路会发送给平台已配置的 AI 服务。生成内容需要结合教材与教师反馈核对。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '生成复盘',
          onPress: () => {
            if (flight.current || uncertain) return;
            flight.current = true;
            setBusy(true);
            setError('');
            void client
              .request<AiReport>(
                aiStudyRoot + '/reports',
                { mistakeIds: Object.keys(selected), reflection },
                'POST',
              )
              .then((report) => {
                if (!live()) return;
                setSelected({});
                setReflection('');
                registerLeave(null);
                registerLeave?.(null);
                openReport(report.id);
              })
              .catch((e) => {
                if (!live()) return;
                setError((e as Error).message);
                if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500) {
                  setUncertain(true);
                  history.reload();
                }
              })
              .finally(() => {
                flight.current = false;
                if (live()) setBusy(false);
              });
          },
        },
      ],
    );
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>AI 错题复盘</Text>
        <Text style={a.body}>从本人真实错题中查找思路偏差，逐题核对推理，并保留可追溯的学习报告。</Text>
        <View style={a.row}>
          <AButton title="选择错题" secondary={tab !== 'new'} onPress={() => setTab('new')} disabled={busy} />
          <AButton
            title="历史复盘"
            secondary={tab !== 'history'}
            onPress={() => {
              setTab('history');
              history.reload();
            }}
            disabled={busy}
          />
        </View>
      </View>
      <AcademicQuery loading={status.loading} error={status.error} retry={status.reload} />
      {status.data && (
        <View style={a.card}>
          <Text style={a.body}>
            {status.data.analysis.available
              ? 'AI 分析可用 · ' + status.data.model
              : status.data.analysis.reason || 'AI 分析暂不可用'}
          </Text>
          <Text style={a.muted}>
            {status.data.search.available
              ? '可按需联网检索来源'
              : status.data.search.reason || '联网检索暂不可用'}{' '}
            · 每日报告、检索和资料下载共用 {status.data.limits.dailyRequests} 次额度
          </Text>
        </View>
      )}
      {!!error && <Text style={a.error}>{error}</Text>}
      {uncertain && (
        <View style={a.card}>
          <Text style={a.notice}>
            请求结果尚未确认，服务器可能已经生成报告。请先查看历史复盘核对，避免重复创建。
          </Text>
          <AButton
            title="查看历史核对结果"
            onPress={() => {
              setTab('history');
              history.reload();
            }}
          />
          <AButton
            title="已核对，允许重新生成"
            secondary
            onPress={() =>
              Alert.alert('确认历史中没有本次报告？', '再次生成会占用新的服务额度。', [
                { text: '取消', style: 'cancel' },
                { text: '确认', onPress: () => setUncertain(false) },
              ])
            }
          />
        </View>
      )}
      {tab === 'new' ? (
        <>
          <View style={a.card}>
            <Text style={a.subtitle}>
              已选 {count} / {max} 道错题
            </Text>
            <Text style={a.muted}>只能使用仍向本人开放的错题，已选内容会在生成前由服务器重新校验。</Text>
            {count > 0 && (
              <AButton title="清空已选错题" secondary disabled={busy} onPress={() => setSelected({})} />
            )}
            <TextInput
              accessibilityLabel="补充解题思路"
              style={[a.input, a.textarea]}
              multiline
              maxLength={2000}
              value={reflection}
              onChangeText={setReflection}
              editable={!busy && !uncertain}
              placeholder="描述当时如何思考，哪里不确定（可选）"
            />
            <AButton
              title={busy ? '正在生成复盘…' : '生成错题复盘'}
              disabled={busy || uncertain || !count || !status.data?.analysis.available || !!status.error}
              onPress={create}
            />
          </View>
          <AcademicQuery loading={mistakes.loading} error={mistakes.error} retry={mistakes.reload} />
          {!mistakes.error &&
            mistakes.data?.items.map((row) => (
              <View key={row.id} style={a.card}>
                {row.question ? (
                  <RichText html={row.question.stem} />
                ) : (
                  <Text style={a.muted}>题目已不再开放</Text>
                )}
                <Text style={a.muted}>
                  答错 {row.wrongCount || 0} 次{row.mastered ? ' · 已标记掌握' : ''}
                </Text>
                <AcademicChoice
                  title={selected[row.id] ? '已选择此错题' : '选择此错题'}
                  selected={!!selected[row.id]}
                  disabled={
                    busy ||
                    uncertain ||
                    !row.available ||
                    !row.question ||
                    (count >= max && !selected[row.id])
                  }
                  onPress={() =>
                    setSelected((old) => {
                      const next = { ...old };
                      if (next[row.id]) delete next[row.id];
                      else next[row.id] = row;
                      return next;
                    })
                  }
                />
              </View>
            ))}
          {!mistakes.loading && !mistakes.error && !mistakes.data?.total && (
            <Text style={a.muted}>当前没有可供复盘的错题。完成课程练习后，本人的错题会出现在这里。</Text>
          )}
          <View style={a.row}>
            <AButton
              title="上一页错题"
              secondary
              disabled={page === 1 || busy}
              onPress={() => setPage((p) => p - 1)}
            />
            <Text style={a.muted}>第 {page} 页</Text>
            <AButton
              title="下一页错题"
              secondary
              disabled={!mistakes.data || page * 10 >= mistakes.data.total || busy}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        </>
      ) : (
        <>
          <AcademicQuery loading={history.loading} error={history.error} retry={history.reload} />
          {!history.error &&
            history.data?.items.map((report) => (
              <View key={report.id} style={a.card}>
                <Text style={a.subtitle}>
                  {report.status === 'ready'
                    ? '复盘已完成'
                    : report.status === 'pending'
                      ? '正在生成'
                      : '生成未完成'}{' '}
                  · {report.mistakeCount} 道题
                </Text>
                <Text style={a.muted}>{new Date(report.createdAt).toLocaleString()}</Text>
                <Text style={a.body}>{report.summary || report.error || '打开查看最新进度'}</Text>
                <AButton title="打开复盘报告" onPress={() => openReport(report.id)} />
              </View>
            ))}
          {!history.loading && !history.error && !history.data?.total && (
            <Text style={a.muted}>还没有可查看的复盘报告。</Text>
          )}
          <View style={a.row}>
            <AButton
              title="上一页报告"
              secondary
              disabled={historyPage === 1}
              onPress={() => setHistoryPage((p) => p - 1)}
            />
            <AButton
              title="下一页报告"
              secondary
              disabled={!history.data || historyPage * 10 >= history.data.total}
              onPress={() => setHistoryPage((p) => p + 1)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

export function AiStudyReportScreen({
  client,
  id,
  openHistory,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  openHistory(): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const path = aiStudyRoot + '/reports/' + encodeURIComponent(id),
    q = useResource<AiReport>(client, path, 5000),
    status = useResource<AiStudyStatus>(client, aiStudyRoot + '/status');
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const initialized = useRef(false),
    flight = useRef(false),
    live = useAcademicLive(client);
  useEffect(() => {
    if (q.data && !initialized.current) {
      initialized.current = true;
      setQuery(q.data.search?.query || q.data.analysis?.searchQueries[0] || '');
    }
  }, [q.data]);
  useAcademicLeave(registerLeave, false, busy);
  const action = async (work: () => Promise<unknown>, message: string) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (live()) {
        setNotice(message);
        q.reload();
      }
    } catch (e) {
      if (live()) {
        setError((e as Error).message);
        q.reload();
      }
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const search = () =>
    Alert.alert('联网查找核对资料？', '检索词会发送给平台配置的搜索服务；检索摘要不代表来源已经核实。', [
      { text: '取消', style: 'cancel' },
      {
        text: '开始检索',
        onPress: () =>
          void action(
            () => client.request(path + '/search', { query: query.trim() }, 'POST'),
            '检索已完成，请逐条核对原文和引用。',
          ),
      },
    ]);
  const remove = () =>
    Alert.alert('删除这份复盘？', '报告及检索结果会删除，原始课程错题记录仍保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void action(async () => {
            await client.request(path, undefined, 'DELETE');
            if (live()) {
              registerLeave(null);
              openHistory();
            }
          }, '报告已删除'),
      },
    ]);
  const report = q.error ? undefined : q.data;
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <View style={a.card}>
        <Text style={a.title}>错题复盘报告</Text>
        <AButton title="刷新报告" secondary onPress={q.reload} disabled={busy} />
        <AButton title="返回历史复盘" secondary onPress={openHistory} disabled={busy} />
      </View>
      <AcademicQuery loading={q.loading} error={q.error} retry={q.reload} />
      {!!error && <Text style={a.error}>{error}</Text>}
      {!!notice && <Text style={a.notice}>{notice}</Text>}
      {report && (
        <>
          <View style={a.card}>
            <Text style={a.subtitle}>
              {report.status === 'ready'
                ? '分析已完成'
                : report.status === 'pending'
                  ? '正在生成，请稍候'
                  : '分析未完成'}
            </Text>
            <Text style={a.muted}>
              {new Date(report.createdAt).toLocaleString()} · AI 内容需结合教材与教师反馈核对
            </Text>
            {report.error && <Text style={a.error}>{report.error}</Text>}
            {!!report.reflection && (
              <>
                <Text style={a.subtitle}>我补充的思路</Text>
                <Text selectable style={a.body}>
                  {report.reflection}
                </Text>
              </>
            )}
            <AButton
              title="导出 Markdown 复盘"
              secondary
              disabled={busy}
              onPress={() =>
                void action(
                  () => shareAiStudyFile(client, id, { format: 'md' }, live),
                  '已打开系统文件保存或分享面板。',
                )
              }
            />
            <AButton
              title="导出 JSON 原始报告"
              secondary
              disabled={busy}
              onPress={() =>
                void action(
                  () => shareAiStudyFile(client, id, { format: 'json' }, live),
                  '已打开系统文件保存或分享面板。',
                )
              }
            />
            <AButton
              title="删除复盘报告"
              secondary
              disabled={busy || report.status === 'pending'}
              onPress={remove}
            />
          </View>
          {report.analysis && (
            <>
              <View style={a.card}>
                <Text style={a.subtitle}>总体分析</Text>
                <Text selectable style={a.body}>
                  {report.analysis.summary}
                </Text>
              </View>
              {report.analysis.patterns.map((p, i) => (
                <View style={a.card} key={i}>
                  <Text style={a.subtitle}>{p.label}</Text>
                  <Text selectable style={a.body}>
                    依据：{p.evidence}
                  </Text>
                  <Text selectable style={a.body}>
                    建议：{p.advice}
                  </Text>
                </View>
              ))}
            </>
          )}
          {report.mistakes.map((m, i) => {
            const analysis = report.analysis?.items.find((item) => item.mistakeId === m.mistakeId);
            return (
              <View key={m.mistakeId} style={a.card}>
                <Text style={a.subtitle}>
                  第 {i + 1} 题 · {m.courseTitle}
                </Text>
                <RichText html={m.stem} />
                {m.options != null && (
                  <Text selectable style={a.body}>
                    题目选项：{aiAnswerText(m.options)}
                  </Text>
                )}
                <Text selectable style={a.body}>
                  原作答：{aiAnswerText(m.studentAnswer)}
                </Text>
                <Text selectable style={a.body}>
                  参考答案：{aiAnswerText(m.correctAnswer)}
                </Text>
                {!!m.explanation && <RichText html={m.explanation} />}
                {analysis && (
                  <>
                    <Text style={a.muted}>
                      AI 自报把握程度：{{ low: '低', medium: '中', high: '高' }[analysis.confidence]}
                      （不等同于准确率）
                    </Text>
                    <Text selectable style={a.body}>
                      问题诊断：{analysis.diagnosis}
                    </Text>
                    <Text selectable style={a.body}>
                      推理过程：{analysis.reasoning}
                    </Text>
                    <Text selectable style={a.body}>
                      修正思路：{analysis.correction}
                    </Text>
                    <Text style={a.muted}>知识点：{analysis.knowledgePoints.join('、')}</Text>
                  </>
                )}
              </View>
            );
          })}
          {report.analysis && (
            <View style={a.card}>
              <Text style={a.subtitle}>复习计划</Text>
              {report.analysis.reviewPlan.map((step, i) => (
                <Text selectable key={i} style={a.body}>
                  {i + 1}. {step}
                </Text>
              ))}
            </View>
          )}
          <View style={a.card}>
            <Text style={a.subtitle}>来源核对</Text>
            <Text style={a.body}>
              先阅读原文，再检查结论是否适用于本题。来源摘要与 AI 分析都可能存在遗漏。
            </Text>
            {status.error && <Text style={a.error}>{status.error}</Text>}
            {!status.data?.search.available && (
              <Text style={a.notice}>{status.data?.search.reason || '正在核对搜索服务状态'}</Text>
            )}
            {report.analysis?.searchQueries.map((value, i) => (
              <AButton key={i} title={value} secondary disabled={busy} onPress={() => setQuery(value)} />
            ))}
            <TextInput
              accessibilityLabel="来源检索词"
              style={[a.input, a.textarea]}
              multiline
              maxLength={300}
              value={query}
              onChangeText={setQuery}
              editable={!busy}
            />
            <AButton
              title={busy ? '正在处理…' : '联网查找来源'}
              disabled={
                busy ||
                !query.trim() ||
                report.status !== 'ready' ||
                !status.data?.search.available ||
                !!status.error
              }
              onPress={search}
            />
            {report.searchError && <Text style={a.error}>{report.searchError}</Text>}
          </View>
          {report.search && (
            <>
              <View style={a.card}>
                <Text style={a.subtitle}>检索摘要</Text>
                <Text style={a.muted}>
                  {report.search.query} · {new Date(report.search.searchedAt).toLocaleString()}
                </Text>
                <Text selectable style={a.body}>
                  {report.search.summary}
                </Text>
              </View>
              {report.search.sources.map((source) => {
                const url = aiSourceUrl(source.url);
                return (
                  <View style={a.card} key={source.id}>
                    <Text style={a.subtitle}>{source.title}</Text>
                    <Text selectable style={a.link}>
                      {source.url}
                    </Text>
                    <Text selectable style={a.body}>
                      {source.snippet}
                    </Text>
                    {aiCitationText(report.search!, source.id).map((text, i) => (
                      <Text selectable key={i} style={a.notice}>
                        该来源对应的摘要片段：{text}
                      </Text>
                    ))}
                    <AButton
                      title="打开原文核对"
                      secondary
                      disabled={!url || busy}
                      onPress={() => {
                        if (url)
                          void Linking.openURL(url).catch(() => {
                            if (live()) setError('无法打开原文，请复制网址在浏览器中查看。');
                          });
                      }}
                    />
                    <AButton
                      title="安全下载此来源资料"
                      disabled={busy || !status.data}
                      onPress={() =>
                        void action(
                          () =>
                            shareAiStudyFile(
                              client,
                              id,
                              {
                                sourceId: source.id,
                                maxBytes: Math.min(50, status.data?.limits.maxDownloadMb || 10) * 1024 * 1024,
                              },
                              live,
                            ),
                          '资料已交给系统打开或保存。服务器已检查下载来源与文件限制。',
                        )
                      }
                    />
                  </View>
                );
              })}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
