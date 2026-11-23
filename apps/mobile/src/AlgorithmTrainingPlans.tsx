import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { MobileApiError, type MobileClient } from './client';
import type { LeaveGuard } from './Assignments';
import { a, AButton } from './assignment-ui';
import { algorithmLearningApi as api, learningText, type TrainingPlans } from './algorithm-learning-model';
export function AlgorithmTrainingPlans({
  client,
  open,
  registerLeave,
}: {
  client: MobileClient;
  open(id: string): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const [data, setData] = useState<TrainingPlans | null>(null),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [checked, setChecked] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    reading = useRef(false);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  const load = async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const next = await api.plans(client);
      if (alive()) {
        setData(next);
        setChecked(true);
      }
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        setChecked(false);
      }
    } finally {
      reading.current = false;
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      setData(null);
      setTitle('');
      setDescription('');
      setIds([]);
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, [client]);
  useEffect(() => {
    registerLeave(
      title || description || ids.length || busy || unknown
        ? (proceed) => {
            if (flight.current) {
              Alert.alert('正在创建训练计划', '请等待请求结束。');
              return;
            }
            Alert.alert(
              '离开训练计划？',
              unknown
                ? '创建结果尚未确认，重新进入后请先核对计划列表。'
                : '未创建的计划内容只保留在当前页面。',
              [
                { text: '继续编辑', style: 'cancel' },
                { text: '放弃并离开', style: 'destructive', onPress: proceed },
              ],
            );
          }
        : null,
    );
    return () => registerLeave(null);
  }, [title, description, ids, busy, unknown, registerLeave]);
  const create = async () => {
    if (flight.current || unknown) return;
    try {
      learningText(title, 120, '计划名称');
      if (description.length > 800 || description.includes('\0'))
        throw new Error('计划说明最多800字符，不能包含空字符');
      if (!ids.length || ids.length > 50) throw new Error('请选择1至50道题');
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setMessage('');
    setChecked(false);
    try {
      await api.createPlan(client, title, description, ids);
      if (alive()) {
        setTitle('');
        setDescription('');
        setIds([]);
        setMessage('私人训练计划已创建。进度由正式提交的通过记录计算。');
        await load();
      }
    } catch (e) {
      if (alive()) {
        setMessage((e as Error).message);
        if (!(e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status))) {
          setUnknown(true);
          setMessage('创建结果尚未确认。请先刷新并核对计划列表，不会自动重复创建。');
        }
      }
    } finally {
      flight.current = false;
      if (alive()) setBusy(false);
    }
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={a.page}>
      <Text style={a.title}>私人算法训练计划</Text>
      <Text style={a.muted}>与网站共享当前学习空间的计划。样例运行、AI解析和标记掌握不会增加通过题数。</Text>
      <AButton title="刷新本人训练计划" disabled={busy} secondary onPress={() => void load()} />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      ) : null}
      {data && (
        <>
          <Text style={a.muted}>
            已有 {data.items.length} / {data.limits.maxPlans} 份计划
          </Text>
          {data.items.map((plan) => (
            <View style={a.card} key={plan.id}>
              <Text style={a.subtitle}>
                {plan.title}
                {plan.archived ? '（已归档）' : ''}
              </Text>
              <Text selectable style={a.body}>
                {plan.description}
              </Text>
              <Text style={a.muted}>
                正式通过 {plan.solved} / {plan.total} 题
              </Text>
              {plan.problems.map((problem) => (
                <AButton
                  key={problem.id}
                  title={`${problem.number}. ${problem.title} · ${problem.status === 'solved' ? '已通过' : problem.status === 'attempted' ? '已尝试' : '未尝试'}`}
                  secondary
                  onPress={() => open(problem.id)}
                />
              ))}
            </View>
          ))}
          <View style={a.card}>
            <Text style={a.subtitle}>创建训练计划</Text>
            <TextInput
              accessibilityLabel="算法训练计划名称"
              placeholder="例如：数组与图的两周复习"
              value={title}
              onChangeText={setTitle}
              editable={!busy}
              maxLength={120}
              style={a.input}
            />
            <TextInput
              accessibilityLabel="算法训练计划说明"
              placeholder="学习安排和复盘重点（可选）"
              value={description}
              onChangeText={setDescription}
              editable={!busy}
              multiline
              maxLength={800}
              style={[a.input, a.textarea]}
            />
            <Text style={a.muted}>
              已选 {ids.length} / {data.limits.maxProblems} 题，按选择顺序排列
            </Text>
            {data.catalog.map((problem) => (
              <AButton
                key={problem.id}
                title={`${ids.includes(problem.id) ? '已选 ' + (ids.indexOf(problem.id) + 1) + ' · ' : ''}${problem.number}. ${problem.title}`}
                secondary={!ids.includes(problem.id)}
                disabled={busy || (!ids.includes(problem.id) && ids.length >= data.limits.maxProblems)}
                onPress={() =>
                  setIds((old) =>
                    old.includes(problem.id) ? old.filter((id) => id !== problem.id) : [...old, problem.id],
                  )
                }
              />
            ))}
            <AButton
              title="创建本人训练计划"
              disabled={busy || unknown || data.items.length >= data.limits.maxPlans}
              onPress={() =>
                Alert.alert('创建私人训练计划？', '只保存到本人当前学习空间。', [
                  { text: '取消', style: 'cancel' },
                  { text: '确认创建', onPress: () => void create() },
                ])
              }
            />
            {unknown && (
              <AButton
                title="已核对计划列表，继续编辑"
                disabled={!checked || busy}
                secondary
                onPress={() =>
                  Alert.alert(
                    '已核对是否创建成功？',
                    '若列表已有此次计划，请先清空创建内容，避免重复创建。',
                    [
                      { text: '返回核对', style: 'cancel' },
                      {
                        text: '已确认，继续编辑',
                        onPress: () => {
                          setUnknown(false);
                          setChecked(false);
                        },
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}
