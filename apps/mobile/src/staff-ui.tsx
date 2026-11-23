import React, { useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { a, AButton } from './assignment-ui';
import type { MobileClient } from './client';
import { useResource } from './resource';
export type Option = { id: string; name: string };
export function Field({
  label,
  value,
  set,
  secret = false,
  multiline = false,
}: {
  label: string;
  value: string;
  set(v: string): void;
  secret?: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text style={a.body}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={a.input}
        value={value}
        onChangeText={set}
        autoCapitalize="none"
        secureTextEntry={secret}
        multiline={multiline}
      />
    </View>
  );
}
export function Picker({
  label,
  items,
  id,
  change,
}: {
  label: string;
  items: Option[];
  id: string;
  change(id: string): void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  return (
    <View>
      <AButton
        secondary
        title={label + ' · ' + (items.find((item) => item.id === id)?.name || '请选择')}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={a.card}>
          <Field label={'查找' + label} value={search} set={setSearch} />
          {items
            .filter((o) => o.name.includes(search))
            .map((o) => (
              <AButton
                secondary
                key={o.id}
                title={o.name}
                onPress={() => {
                  change(o.id);
                  setOpen(false);
                  setSearch('');
                }}
              />
            ))}
        </View>
      )}
    </View>
  );
}
export function State({ resource }: { resource: { loading: boolean; error?: string; reload(): void } }) {
  if (resource.error)
    return (
      <View>
        <Text accessibilityRole="alert" style={a.error}>
          {resource.error}
        </Text>
        <AButton secondary title="重新加载" onPress={resource.reload} />
      </View>
    );
  return resource.loading ? <Text style={a.muted}>正在加载…</Text> : null;
}
export function useSave(client: MobileClient) {
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  async function save(path: string, body: unknown, method = 'POST', done?: () => void | Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    try {
      await client.request(path, body, method);
      await done?.();
      setNotice('已保存');
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { save, busy, notice };
}
export function confirmAction(title: string, message: string, run: () => void) {
  Alert.alert(title, message, [
    { text: '取消', style: 'cancel' },
    { text: '确认', onPress: run },
  ]);
}
export function Pager({ page, total, change }: { page: number; total: number; change(n: number): void }) {
  return (
    <View style={a.row}>
      <AButton secondary title="上一页" disabled={page <= 1} onPress={() => change(page - 1)} />
      <Text>
        {page} / {Math.max(1, Math.ceil(total / 20))}
      </Text>
      <AButton secondary title="下一页" disabled={page * 20 >= total} onPress={() => change(page + 1)} />
    </View>
  );
}
export function usePage<T>(client: MobileClient, path: string, page: number) {
  return useResource<{ items: T[]; total: number }>(
    client,
    path + (path.includes('?') ? '&' : '?') + 'page=' + page + '&pageSize=20',
  );
}
