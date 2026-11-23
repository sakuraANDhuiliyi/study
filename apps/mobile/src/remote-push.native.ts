import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { remoteInboxNotification, remotePushApi, type RemotePushStatus } from './remote-push-model';
import { initializeStudyNotificationHandler, setRemoteStudyBinding } from './study-reminders.native';
export function remotePushBuildReady() {
  return Constants.expoConfig?.extra?.remotePushConfigured === true;
}
export async function enableRemoteStudyPush(client: MobileClient, status: RemotePushStatus) {
  const epoch = client.sessionEpoch();
  if (!remotePushBuildReady()) throw new Error('此安装包未配置远程推送项目；学习收件箱与本机提醒仍可使用');
  if (!status.available || !status.projectId) throw new Error(status.reason || '服务器未启用远程推送');
  const localProject = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (localProject !== status.projectId) throw new Error('安装包与服务器推送项目不匹配');
  initializeStudyNotificationHandler();
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('remote-study-inbox', {
      name: '远程学习动态',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: null,
    });
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted)
    throw new Error('系统通知权限未开启');
  if (!client.ownsSession(epoch)) throw new Error('身份已变化，未启用远程通知');
  const token = await Notifications.getExpoPushTokenAsync({ projectId: status.projectId });
  if (!client.ownsSession(epoch)) throw new Error('身份已变化，未绑定推送设备');
  const bound = await remotePushApi.bind(client, token.data, status.projectId);
  if (!client.ownsSession(epoch)) throw new Error('身份已变化');
  setRemoteStudyBinding(bound.bindingId);
  return bound;
}
async function dismissRemoteStudyPush() {
  const items = await Notifications.getPresentedNotificationsAsync();
  await Promise.allSettled(
    items
      .filter((n) => n.request.content.data?.kind === 'study-inbox')
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
  );
}
/** Register in the authenticated shell. Incoming URLs and notification bodies are never used for navigation. */
export function bindRemoteStudyPush(client: MobileClient, user: MobileUser, openInbox: () => void) {
  if (user.role !== 'STUDENT') return () => {};
  let active = true,
    bindingId: string | null = null;
  const epoch = client.sessionEpoch(),
    seen = new Set<string>();
  const alive = () => active && client.ownsSession(epoch);
  initializeStudyNotificationHandler();
  const inspect = async (response: Notifications.NotificationResponse | null) => {
    if (!response || !alive() || seen.has(response.notification.request.identifier)) return;
    seen.add(response.notification.request.identifier);
    try {
      const status = await remotePushApi.status(client);
      bindingId = status.bindingId;
      if (!alive()) return;
      setRemoteStudyBinding(bindingId);
      if (!remoteInboxNotification(response.notification.request.content.data, bindingId)) return;
      await client.request('/mobile/auth/me');
      if (alive()) {
        await Notifications.clearLastNotificationResponseAsync();
        openInbox();
      }
    } catch {
      /* The ordinary login/inbox path stays available; never follow a stale external payload. */
    }
  };
  const listener = Notifications.addNotificationResponseReceivedListener(
    (response) => void inspect(response),
  );
  void remotePushApi
    .status(client)
    .then(async (status) => {
      if (!alive()) return;
      bindingId = status.bindingId;
      setRemoteStudyBinding(bindingId);
      await inspect(await Notifications.getLastNotificationResponseAsync());
    })
    .catch(() => undefined);
  const off = client.onSessionInvalidated(() => {
    if (!active) return;
    active = false;
    setRemoteStudyBinding(null);
    listener.remove();
    // logout deletes its Session (and bound device) server-side; this also covers an explicit local replacement while still online.
    void remotePushApi.remove(client).catch(() => undefined);
    void dismissRemoteStudyPush().catch(() => undefined);
  });
  return () => {
    active = false;
    off();
    listener.remove();
    setRemoteStudyBinding(null);
    void dismissRemoteStudyPush().catch(() => undefined);
  };
}
