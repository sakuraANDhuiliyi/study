import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import type { LeaveGuard } from './Assignments';
import { MobileApiError, type MobileClient } from './client';
import { useResource } from './resource';
import { a, AButton } from './assignment-ui';
import {
  AcademicChoice,
  AcademicFieldInput,
  AcademicQuery,
  AcademicResultView,
  useAcademicLeave,
  useAcademicLive,
} from './academic-ui';
import {
  academicRoot,
  academicForm,
  academicValues,
  academicsApi,
  kindLabels,
  type AcademicModule,
  type AcademicForm,
  type AcademicRecord,
} from './academics-model';
export function AcademicWorkbench({
  client,
  id,
  recordId,
  openRecord,
  openRecords,
  openAlgorithms,
  openGoals,
  registerLeave,
}: {
  client: MobileClient;
  id: string;
  recordId?: string;
  openRecord(id: string): void;
  openRecords(): void;
  openAlgorithms(): void;
  openGoals(moduleId: string): void;
  registerLeave(guard: LeaveGuard): void;
}) {
  const q = useResource<AcademicModule>(client, academicRoot + '/modules/' + encodeURIComponent(id));
  const [module, setModule] = useState<AcademicModule | null>(null),
    [form, setForm] = useState<AcademicForm>({}),
    [baseline, setBaseline] = useState(''),
    [title, setTitle] = useState(''),
    [baselineTitle, setBaselineTitle] = useState('');
  const [result, setResult] = useState<AcademicRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [uncertain, setUncertain] = useState(false),
    [restoring, setRestoring] = useState(false);
  const flight = useRef(false),
    restored = useRef(false),
    live = useAcademicLive(client);
  useEffect(() => {
    if (q.data && !module) {
      const values = academicForm(q.data);
      setModule(q.data);
      setForm(values);
      setBaseline(JSON.stringify(values));
      setTitle(q.data.title);
      setBaselineTitle(q.data.title);
    }
  }, [q.data, module]);
  useEffect(() => {
    if (!module || !recordId || restored.current) return;
    restored.current = true;
    let active = true;
    setRestoring(true);
    void academicsApi
      .record(client, recordId)
      .then((record) => {
        if (!active || !live()) return;
        if (record.moduleId !== id) throw new Error('此记录属于其他学习模块');
        const values = academicForm(module, record.values);
        setForm(values);
        setBaseline(JSON.stringify(values));
        setTitle(record.title);
        setBaselineTitle(record.title);
        setNotice('已从已保存记录载入参数，运行会创建一条新记录。');
      })
      .catch((e) => {
        if (active && live()) setError((e as Error).message);
      })
      .finally(() => {
        if (active && live()) setRestoring(false);
      });
    return () => {
      active = false;
    };
    // The keyed workspace owns one restore request, never a background overwrite of edited input.
  }, [module, recordId, client, id]);
  useAcademicLeave(
    registerLeave,
    !!module && (JSON.stringify(form) !== baseline || title !== baselineTitle || uncertain),
    busy || restoring,
  );
  const run = async () => {
    if (!module || flight.current || uncertain) return;
    let values: Record<string, unknown>;
    try {
      values = academicValues(module, form);
      if (!title.trim()) throw new Error('请填写记录标题');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await client.request<{ record: AcademicRecord }>(
        academicRoot + '/modules/' + encodeURIComponent(id) + '/evaluate',
        { values, title: title.trim() },
        'POST',
      );
      if (!live()) return;
      setResult(response.record);
      setBaseline(JSON.stringify(form));
      setTitle(response.record.title);
      setBaselineTitle(response.record.title);
      setNotice('本次实验已保存，可继续为记录补充笔记。');
    } catch (e) {
      if (!live()) return;
      setError((e as Error).message);
      if (!(e instanceof MobileApiError) || e.status === 0 || e.status >= 500) {
        setUncertain(true);
        setNotice('连接中断，服务器可能已保存这次实验。请先查看学习记录核对，避免重复运行。');
      }
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  const loadExample = (example: AcademicModule['examples'][number]) =>
    Alert.alert('载入示例？', '将替换当前参数，已保存的学习记录不受影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '载入示例',
        onPress: () => {
          if (!module) return;
          setForm(academicForm(module, example.values));
          setNotice(example.explanation);
          setError('');
        },
      },
    ]);
  const disabled = busy || restoring || !!q.error;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
        <AcademicQuery loading={q.loading || restoring} error={q.error} retry={q.reload} />
        {module && !q.error && (
          <>
            <View style={a.card}>
              <Text style={a.title}>{module.title}</Text>
              <Text style={a.muted}>
                {kindLabels[module.kind]} · 约 {module.estimatedMinutes} 分钟
              </Text>
              <Text style={a.body}>{module.description}</Text>
              {module.learningObjectives.map((objective, i) => (
                <Text key={i} style={a.body}>
                  • {objective}
                </Text>
              ))}
              <AButton
                title="为本模块设定学习目标"
                secondary
                onPress={() => openGoals(id)}
                disabled={busy || restoring}
              />
            </View>
            <View style={a.card}>
              <Text style={a.subtitle}>原理与操作</Text>
              {module.concepts.map((c, i) => (
                <View key={i}>
                  <Text style={a.subtitle}>{c.title}</Text>
                  <Text selectable style={a.body}>
                    {c.content}
                  </Text>
                </View>
              ))}
              {module.instructions.map((step, i) => (
                <Text key={i} style={a.body}>
                  {i + 1}. {step}
                </Text>
              ))}
            </View>
            {module.kind === 'algorithm' ? (
              <AButton title="进入算法题库" onPress={openAlgorithms} />
            ) : (
              <>
                <View style={a.card}>
                  <Text style={a.subtitle}>示例</Text>
                  {module.examples.map((ex, i) => (
                    <View key={i} style={{ gap: 6 }}>
                      <AButton
                        title={ex.title}
                        secondary
                        disabled={disabled || uncertain}
                        onPress={() => loadExample(ex)}
                      />
                      <Text style={a.muted}>{ex.explanation}</Text>
                    </View>
                  ))}
                </View>
                <View style={a.card}>
                  <Text style={a.subtitle}>实验输入</Text>
                  <TextInput
                    accessibilityLabel="学习记录标题"
                    style={a.input}
                    value={title}
                    onChangeText={setTitle}
                    editable={!disabled}
                    maxLength={160}
                  />
                  {module.fields.map((field) => (
                    <AcademicFieldInput
                      key={field.key}
                      field={field}
                      value={form[field.key]}
                      disabled={disabled || uncertain}
                      setValue={(value) => setForm((f) => ({ ...f, [field.key]: value }))}
                    />
                  ))}
                  {module.questions?.map((question, i) => (
                    <View key={question.id} style={{ gap: 8 }}>
                      <Text style={a.subtitle}>
                        {i + 1}. {question.prompt}
                      </Text>
                      {question.choices.map((choice) => (
                        <AcademicChoice
                          key={choice.id}
                          title={choice.label}
                          selected={
                            typeof form.answers === 'object' && form.answers[question.id] === choice.id
                          }
                          disabled={disabled || uncertain}
                          onPress={() =>
                            setForm((f) => ({
                              ...f,
                              answers: {
                                ...(typeof f.answers === 'object' ? f.answers : {}),
                                [question.id]: choice.id,
                              },
                            }))
                          }
                        />
                      ))}
                    </View>
                  ))}
                  {!!error && <Text style={a.error}>{error}</Text>}
                  {!!notice && <Text style={a.notice}>{notice}</Text>}
                  {uncertain ? (
                    <>
                      <AButton title="查看学习记录核对结果" onPress={openRecords} />
                      <AButton
                        title="已核对，允许重新运行"
                        secondary
                        onPress={() =>
                          Alert.alert(
                            '确认已核对记录？',
                            '再次运行会创建新记录。如果刚才已保存，请直接编辑那条记录。',
                            [
                              { text: '取消', style: 'cancel' },
                              {
                                text: '允许重新运行',
                                onPress: () => {
                                  setUncertain(false);
                                  setNotice('可修改参数后重新运行。');
                                },
                              },
                            ],
                          )
                        }
                      />
                    </>
                  ) : (
                    <AButton
                      title={
                        busy
                          ? '正在计算并保存…'
                          : module.kind === 'workspace'
                            ? '保存学习内容'
                            : module.kind === 'quiz'
                              ? '提交测验并保存'
                              : '运行实验并保存'
                      }
                      disabled={disabled}
                      onPress={() => void run()}
                    />
                  )}
                  <Text style={a.muted}>
                    成功后保存一条完整记录。完成表示本次练习已记录，不等同于掌握程度或评分。
                  </Text>
                </View>
                {result && (
                  <>
                    <View style={a.card}>
                      <Text style={a.subtitle}>{result.title}</Text>
                      <Text style={a.muted}>
                        以下结果对应这条记录已保存的输入。修改上方参数后，需要再次运行才会生成新的结果。
                      </Text>
                      <AButton
                        title="查看此记录与编辑笔记"
                        onPress={() => openRecord(result.id)}
                        disabled={busy}
                      />
                    </View>
                    <AcademicResultView key={result.id} result={result.result} />
                  </>
                )}
              </>
            )}
            {module.resources.length > 0 && (
              <View style={a.card}>
                <Text style={a.subtitle}>参考资料</Text>
                {module.resources.map((r, i) => (
                  <View key={i}>
                    <Text style={a.body}>{r.title}</Text>
                    <Text selectable style={a.link}>
                      {r.url}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
