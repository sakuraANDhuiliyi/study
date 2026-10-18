import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { richParts, decodeText, money, type AnswerValue, type Question } from './assignment-model';
export const a = StyleSheet.create({
  page: { padding: 18, gap: 14, paddingBottom: 30 },
  flex: { flex: 1 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e9e8f2',
  },
  title: { fontSize: 23, fontWeight: '800', color: '#302b43', lineHeight: 33 },
  subtitle: { fontSize: 18, fontWeight: '700', color: '#302b43', lineHeight: 27 },
  body: { fontSize: 15, lineHeight: 25, color: '#514d64' },
  muted: { fontSize: 13, lineHeight: 22, color: '#77748a' },
  link: { fontSize: 14, color: '#6d45dc', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  input: {
    backgroundColor: '#faf9fd',
    borderWidth: 1,
    borderColor: '#ded8ec',
    borderRadius: 12,
    minHeight: 50,
    padding: 12,
    fontSize: 15,
    color: '#302b43',
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  button: {
    minHeight: 48,
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6d45dc',
  },
  buttonText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  secondary: { backgroundColor: '#eeebf8' },
  secondaryText: { color: '#6544bd' },
  disabled: { opacity: 0.4 },
  notice: { padding: 12, borderRadius: 10, backgroundColor: '#efe9fb', color: '#60448e', lineHeight: 23 },
  error: { padding: 12, borderRadius: 10, backgroundColor: '#fff1ee', color: '#ad3939', lineHeight: 23 },
  option: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: '#e5e0ee',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  chosen: { borderColor: '#8b6ada', backgroundColor: '#f0ebfb' },
  choiceMarker: { fontSize: 20, color: '#7551c5' },
  child: { padding: 12, gap: 12, backgroundColor: '#faf8ff', borderRadius: 12 },
  image: { width: '100%', height: 220, borderRadius: 8 },
});
export function AButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[a.button, secondary && a.secondary, disabled && a.disabled]}
    >
      <Text style={[a.buttonText, secondary && a.secondaryText]}>{title}</Text>
    </Pressable>
  );
}
function QuestionImage({ uri, label }: { uri: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <Text style={a.error}>{label}加载失败，请刷新作业或检查网络。</Text>
  ) : (
    <Image
      accessibilityLabel={label}
      source={{ uri }}
      resizeMode="contain"
      style={a.image}
      onError={() => setFailed(true)}
    />
  );
}
export function RichText({ html }: { html: string }) {
  return (
    <View style={{ gap: 10 }}>
      {richParts(html).map((part, i) =>
        part.kind === 'image' ? (
          <QuestionImage key={i} uri={part.value} label={part.alt || '题目图片'} />
        ) : (
          <Text key={i} selectable style={a.body}>
            {part.value}
          </Text>
        ),
      )}
    </View>
  );
}
export function AnswerInput({
  question: q,
  label,
  value,
  change,
  disabled,
}: {
  question: Question;
  label: string;
  value: AnswerValue | undefined;
  change(v: AnswerValue): void;
  disabled: boolean;
}) {
  if (q.type === 'single' || q.type === 'multiple' || q.type === 'boolean') {
    const options =
      q.type === 'boolean'
        ? [
            { id: 'true', text: '正确' },
            { id: 'false', text: '错误' },
          ]
        : q.options;
    return (
      <View style={{ gap: 8 }}>
        {options.map((o) => {
          const selected =
            q.type === 'multiple'
              ? Array.isArray(value) && value.includes(o.id)
              : q.type === 'boolean'
                ? value === (o.id === 'true') || value === o.id
                : value === o.id;
          return (
            <Pressable
              key={o.id}
              accessibilityRole={q.type === 'multiple' ? 'checkbox' : 'radio'}
              accessibilityLabel={label + '：' + decodeText(o.text)}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => {
                if (q.type === 'multiple') {
                  const old = Array.isArray(value) ? value : [];
                  change(selected ? old.filter((x) => x !== o.id) : [...old, o.id]);
                } else change(q.type === 'boolean' ? o.id === 'true' : o.id);
              }}
              style={[a.option, selected && a.chosen, disabled && a.disabled]}
            >
              <Text style={a.choiceMarker}>{selected ? '●' : '○'}</Text>
              <Text style={[a.body, a.flex]}>{decodeText(o.text)}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  if (q.type === 'composite')
    return (
      <View style={{ gap: 12 }}>
        {q.children.map((child, i) => (
          <View key={child.id} style={a.child}>
            <Text style={a.muted}>
              子题 {i + 1} · {money(child.scoreCents)} 分
            </Text>
            <RichText html={child.stem} />
            <AnswerInput
              question={child}
              label={label + '-子题' + (i + 1)}
              disabled={disabled}
              value={
                value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, child.id)
                  ? value[child.id]
                  : undefined
              }
              change={(v) =>
                change({
                  ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
                  [child.id]: v as never,
                })
              }
            />
          </View>
        ))}
      </View>
    );
  if (q.type === 'blank' || q.type === 'short')
    return (
      <TextInput
        accessibilityLabel={label + '答案'}
        value={typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : ''}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        maxLength={500000}
        style={[a.input, a.textarea]}
        onChangeText={(v) => change(q.type === 'blank' ? v.split('\n') : v)}
        placeholder={q.type === 'blank' ? '每个填空答案独占一行' : '输入你的答案、思路与过程'}
      />
    );
  return (
    <Text accessibilityRole="alert" style={a.error}>
      当前题型无法作答，请联系教师核对。
    </Text>
  );
}
export function AnswerDisplay({ value }: { value: unknown }) {
  const formatted =
    typeof value === 'boolean'
      ? value
        ? '正确'
        : '错误'
      : typeof value === 'string'
        ? decodeText(value)
        : value === null || value === undefined
          ? '未作答'
          : JSON.stringify(value, null, 2);
  return (
    <Text selectable style={a.body}>
      {formatted}
    </Text>
  );
}
export function AQuery({ q }: { q: { loading: boolean; error?: string; reload(): void } }) {
  return (
    <>
      {q.loading && <ActivityIndicator color="#6d45dc" />}
      {q.error && (
        <View style={a.card}>
          <Text accessibilityRole="alert" style={a.error}>
            {q.error}
          </Text>
          <AButton title="重新加载作业" secondary onPress={q.reload} />
        </View>
      )}
    </>
  );
}
