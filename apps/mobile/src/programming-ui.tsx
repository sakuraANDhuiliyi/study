import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import type { ProjectFile } from './programming-model';
export function useProgrammingOperation(client: MobileClient) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const alive = useRef(true),
    flight = useRef(false),
    epoch = useRef(client.sessionEpoch());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const live = () => alive.current && client.ownsSession(epoch.current);
  const run = async <T,>(operation: () => Promise<T>, done?: (result: T) => void) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await operation();
      if (live()) {
        setNotice('操作已完成。');
        done?.(result);
      }
    } catch (error) {
      if (live()) setNotice((error as Error).message);
    } finally {
      flight.current = false;
      if (live()) setBusy(false);
    }
  };
  return { run, busy, notice, setNotice };
}
export function ReadonlyProjectFiles({
  files,
  label = '只读源码',
}: {
  files: ProjectFile[];
  label?: string;
}) {
  const [selected, setSelected] = useState(files[0]?.path || 'index.html');
  const current = files.find((file) => file.path === selected) || files[0];
  if (!current) return <Text style={a.muted}>暂无源码。</Text>;
  return (
    <View style={a.card}>
      <Text style={a.subtitle}>{label}</Text>
      <View style={a.row}>
        {files.map((file) => (
          <AButton
            key={file.path}
            title={file.path}
            secondary={file.path !== current.path}
            onPress={() => setSelected(file.path)}
          />
        ))}
      </View>
      <TextInput
        accessibilityLabel={label + '：' + current.path}
        multiline
        editable={false}
        value={current.content}
        style={[
          a.input,
          { minHeight: 180, maxHeight: 450, fontFamily: 'monospace', fontSize: 13, textAlignVertical: 'top' },
        ]}
        scrollEnabled
      />
    </View>
  );
}
