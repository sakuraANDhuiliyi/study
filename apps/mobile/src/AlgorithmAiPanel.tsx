import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Text, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import {
  algorithmLanguageLabels,
  validateAlgorithmCode,
  type CodeEdit,
  type CodeSubmission,
  type JudgeStatus,
} from './algorithm-workspace-model';
import {
  algorithmLearningApi as api,
  analysisSubmission,
  type AlgorithmAnalysis,
} from './algorithm-learning-model';
const labels = { hint: '思路提示', explain: '完整解析', debug: '代码诊断' };
export function AlgorithmAiPanel({
  client,
  problemId,
  intent,
  submission,
  availability,
}: {
  client: MobileClient;
  problemId: string;
  intent: CodeEdit;
  submission: CodeSubmission | null;
  availability: JudgeStatus['ai'];
}) {
  const [items, setItems] = useState<AlgorithmAnalysis[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [unknown, setUnknown] = useState<number | null>(null),
    [retryReady, setRetryReady] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    reading = useRef(false);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const read = async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const data = await api.analyses(client, problemId);
      if (alive()) {
        setItems(data.items);
        setRetryReady(
          unknown !== null &&
            Date.now() - unknown >= 210000 &&
            !data.items.some((item) => item.status === 'pending'),
        );
      }
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      reading.current = false;
    }
  };
  useEffect(() => {
    mounted.current = true;
    void read();
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      setItems([]);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client, problemId]);
  useEffect(() => {
    if (!items.some((item) => item.status === 'pending')) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void read();
    }, 5000);
    return () => clearInterval(timer);
  }, [items]);
  const generate = async (mode: AlgorithmAnalysis['mode']) => {
    if (flight.current || unknown !== null) return;
    try {
      validateAlgorithmCode(intent.code);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setMessage('正在生成解析，当前代码已作为本次快照。');
    const started = Date.now();
    try {
      const report = await api.analyze(client, problemId, { ...intent }, mode, submission);
      if (alive()) {
        setItems((old) => [report, ...old.filter((x) => x.id !== report.id)].slice(0, 30));
        setMessage(
          report.status === 'failed'
            ? report.error || '解析未完成'
            : '解析已保存。AI建议需要结合运行结果自行核对。',
        );
      }
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        if (!(
          e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429, 503].includes(e.status)
        )) {
          setUnknown(started);
          setRetryReady(false);
          setMessage('解析结果尚未确认。请先刷新解析记录，不会自动重复生成。');
        }
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  return (
    <View style={a.child}>
      <Text style={a.subtitle}>AI 算法导师</Text>
      <Text style={a.muted}>
        使用当前 {algorithmLanguageLabels[intent.language]} 代码。
        {analysisSubmission(intent, submission)
          ? '代码诊断将结合选中的真实运行记录。'
          : '代码诊断仅分析当前代码；当前代码与选中运行快照不一致时不会附带旧结果。'}
        生成结果不会改写代码或代替判题。
      </Text>
      {!availability?.available && (
        <Text style={a.notice}>{availability?.reason || 'AI服务暂不可用，请联系管理员配置。'}</Text>
      )}
      {availability?.model && <Text style={a.muted}>模型：{availability.model}</Text>}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      <View style={a.row}>
        {(['hint', 'explain', 'debug'] as const).map((mode) => (
          <AButton
            key={mode}
            title={'AI ' + labels[mode]}
            disabled={
              !availability?.available ||
              busy ||
              unknown !== null ||
              items.some((item) => item.status === 'pending')
            }
            onPress={() =>
              Alert.alert(
                '生成' + labels[mode] + '？',
                '将当前代码发送给平台已配置的AI服务，并使用本人的解析额度。',
                [
                  { text: '取消', style: 'cancel' },
                  { text: '确认生成', onPress: () => void generate(mode) },
                ],
              )
            }
          />
        ))}
      </View>
      <AButton title="刷新本人AI解析记录" secondary onPress={() => void read()} />
      {unknown !== null && (
        <>
          <Text style={a.muted}>
            请核对时间与解析记录。若仍无结果，等待210秒后刷新，确认没有生成中的记录再手动重试。
          </Text>
          <AButton
            title="已核对AI记录，允许再次生成"
            disabled={!retryReady}
            secondary
            onPress={() =>
              Alert.alert('确认核对完毕？', '不会自动生成解析。', [
                { text: '取消', style: 'cancel' },
                {
                  text: '确认',
                  onPress: () => {
                    setUnknown(null);
                    setRetryReady(false);
                  },
                },
              ])
            }
          />
        </>
      )}
      {items.map((item) => (
        <View key={item.id} style={a.card}>
          <Text style={a.subtitle}>
            {labels[item.mode]} · {algorithmLanguageLabels[item.language]}
          </Text>
          <Text style={a.muted}>
            {new Date(item.createdAt).toLocaleString()} ·{' '}
            {item.status === 'ready' ? '已生成' : item.status === 'pending' ? '生成中' : '未完成'}
          </Text>
          {item.error && <Text style={a.error}>{item.error}</Text>}
          {item.content && (
            <>
              <Text selectable style={a.body}>
                {item.content.summary}
              </Text>
              {item.content.approach.map((step, i) => (
                <Text selectable key={i} style={a.body}>
                  {i + 1}. {step}
                </Text>
              ))}
              <Text selectable style={a.body}>
                复杂度：{item.content.complexity}
              </Text>
              {item.content.pitfalls.map((pitfall, i) => (
                <Text selectable key={i} style={a.body}>
                  注意：{pitfall}
                </Text>
              ))}
              {item.content.suggestedCode ? (
                <>
                  <Text style={a.subtitle}>参考代码（未自动运行）</Text>
                  <Text selectable style={a.body}>
                    {item.content.suggestedCode}
                  </Text>
                </>
              ) : null}
            </>
          )}
        </View>
      ))}
    </View>
  );
}
