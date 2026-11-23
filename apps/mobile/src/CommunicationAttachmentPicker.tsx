import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import {
  addCommunicationFile,
  communicationFilesApi,
  type CommunicationFile,
  type CommunicationFilePage,
  type CommunicationFileScope,
} from './communication-files-model';
import { openDiscussionFile, pickCommunicationFile } from './communication-files.native';
export function CommunicationAttachmentPicker({
  client,
  scope,
  files,
  onChange,
  locked,
  onBusy,
}: {
  client: MobileClient;
  scope: CommunicationFileScope;
  files: CommunicationFile[];
  onChange(files: CommunicationFile[]): void;
  locked: boolean;
  onBusy(busy: boolean): void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [listed, setListed] = useState<CommunicationFilePage | null>(null),
    [uncertain, setUncertain] = useState(false),
    [uploading, setUploading] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch()),
    flight = useRef(false),
    cancel = useRef<AbortController | null>(null);
  const alive = () => mounted.current && client.ownsSession(epoch.current);
  useEffect(() => {
    mounted.current = true;
    const off = client.onSessionInvalidated(() => {
      mounted.current = false;
      cancel.current?.abort();
      setListed(null);
    });
    return () => {
      mounted.current = false;
      cancel.current?.abort();
      off();
    };
  }, [client, scope.kind, scope.id]);
  const work = async (task: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusy(true);
    setMessage('');
    try {
      await task();
    } catch (e) {
      if (alive()) setMessage((e as Error).message);
    } finally {
      flight.current = false;
      if (alive()) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const read = async (page = 1) => {
    const rows = await communicationFilesApi.list(client, scope, page);
    if (alive()) setListed(rows);
    return rows;
  };
  const upload = () =>
    work(async () => {
      const rows = await read();
      if (!alive()) return;
      cancel.current = new AbortController();
      setUploading(true);
      try {
        const f = await pickCommunicationFile(client, scope, rows.maxUploadBytes, cancel.current.signal);
        if (alive() && f) {
          onChange(addCommunicationFile(files, f));
          setMessage('服务器已确认上传。附件将在本次发布成功后对接收方可见。');
          setListed(null);
        }
      } catch (e) {
        if (alive()) {
          setUncertain(true);
          setMessage(
            '本次上传未确认。取消或网络中断也可能已上传，请先核对服务器本人附件列表；不会自动重传。 ' +
              (e as Error).message,
          );
        }
      } finally {
        cancel.current = null;
        if (alive()) setUploading(false);
      }
    });
  return (
    <View style={{ gap: 8 }}>
      <Text style={a.subtitle}>本次附件 · {files.length} / 10</Text>
      <Text style={a.muted}>
        仅选择机构允许的文件。上传与发布分开；移出本次发布不会删除服务器文件。未引用文件可主动删除。
      </Text>
      {files.map((f) => (
        <View key={f.id} style={a.card}>
          <Text>
            {f.name} · {(f.size / 1024).toFixed(1)} KiB
          </Text>
          <AButton
            title={'移出本次附件：' + f.name}
            secondary
            disabled={locked || busy}
            onPress={() => onChange(files.filter((r) => r.id !== f.id))}
          />
        </View>
      ))}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={a.notice}>
          {message}
        </Text>
      )}
      <AButton
        title="选择并上传附件"
        disabled={locked || busy || uncertain || files.length >= 10}
        onPress={() => void upload()}
      />
      {busy && uploading && (
        <AButton title="取消附件上传" secondary onPress={() => cancel.current?.abort()} />
      )}
      <AButton
        title="核对服务器本人附件"
        secondary
        disabled={locked || busy}
        onPress={() =>
          void work(async () => {
            await read();
          })
        }
      />
      {listed && (
        <>
          <Text style={a.muted}>
            仅列出本人在当前{scope.kind === 'course' ? '课程' : '会话'}上传的文件，第{listed.page}页，共
            {listed.total}个。
          </Text>
          {listed.items.map((f) => (
            <View style={a.card} key={f.id}>
              <Text>
                {f.name} · {(f.size / 1024).toFixed(1)} KiB
              </Text>
              <AButton
                title={'选入本次发布：' + f.name}
                secondary
                disabled={locked || busy || files.length >= 10 || files.some((r) => r.id === f.id)}
                onPress={() => {
                  try {
                    onChange(addCommunicationFile(files, f));
                    setUncertain(false);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              />
              <AButton
                title={'删除未引用附件：' + f.name}
                secondary
                disabled={locked || busy || files.some((r) => r.id === f.id)}
                onPress={() =>
                  Alert.alert('删除本人未引用附件？', '服务器仍被任何业务记录引用的文件会拒绝删除。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '确认删除',
                      style: 'destructive',
                      onPress: () =>
                        void work(async () => {
                          await communicationFilesApi.remove(client, scope, f.id);
                          await read(listed.page);
                        }),
                    },
                  ])
                }
              />
            </View>
          ))}
          <View style={a.row}>
            <AButton
              title="上一页本人附件"
              secondary
              disabled={locked || busy || listed.page === 1}
              onPress={() =>
                void work(async () => {
                  await read(listed.page - 1);
                })
              }
            />
            <AButton
              title="下一页本人附件"
              secondary
              disabled={locked || busy || listed.page * listed.pageSize >= listed.total}
              onPress={() =>
                void work(async () => {
                  await read(listed.page + 1);
                })
              }
            />
          </View>
          {uncertain && (
            <AButton
              title="已核对附件，继续选择"
              secondary
              disabled={locked || busy}
              onPress={() => {
                setUncertain(false);
                setMessage('已解除上传待核对状态。再次选择会发起新的上传。');
              }}
            />
          )}
        </>
      )}
    </View>
  );
}
export function DiscussionAttachments({
  client,
  postId,
  files,
}: {
  client: MobileClient;
  postId: string;
  files: CommunicationFile[];
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const mounted = useRef(true),
    epoch = useRef(client.sessionEpoch());
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const open = async (f: CommunicationFile) => {
    setBusy(true);
    setMessage('');
    try {
      await openDiscussionFile(client, postId, f);
    } catch (e) {
      if (mounted.current && client.ownsSession(epoch.current)) setMessage((e as Error).message);
    } finally {
      if (mounted.current && client.ownsSession(epoch.current)) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {files.map((f) => (
        <AButton
          key={f.id}
          title={'打开附件：' + f.name}
          secondary
          disabled={busy}
          onPress={() =>
            Alert.alert('打开讨论附件？', '每次下载重新核对权限。选择外部应用后，该应用可能保存副本。', [
              { text: '取消', style: 'cancel' },
              { text: '打开或保存', onPress: () => void open(f) },
            ])
          }
        />
      ))}
      {!!message && <Text style={a.error}>{message}</Text>}
    </View>
  );
}
