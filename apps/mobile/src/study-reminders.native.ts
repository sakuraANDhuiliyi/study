import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MobileClient, MobileUser } from './client';
import { clearOfflineIdentity, deviceLearningScope } from './offline-review.native';
import { reminderContent, reminderIdentifier, reminderTime } from './offline-review-model';
const channelId = 'personal-study-reminders';
const work = new Map<string, Promise<unknown>>();
function serial<T>(scope: string, run: () => Promise<T>) {
  const next = (work.get(scope) || Promise.resolve()).catch(() => undefined).then(run);
  work.set(
    scope,
    next.catch(() => undefined),
  );
  return next;
}
let handler = false;
let remoteBinding: string | null = null;
export function setRemoteStudyBinding(value: string | null) {
  remoteBinding = value;
}
export function initializeStudyNotificationHandler() {
  if (handler) return;
  handler = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldShowBanner:
        notification.request.content.data?.kind !== 'study-inbox' ||
        (!!remoteBinding && notification.request.content.data.bindingId === remoteBinding),
      shouldShowList:
        notification.request.content.data?.kind !== 'study-inbox' ||
        (!!remoteBinding && notification.request.content.data.bindingId === remoteBinding),
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
export async function studyReminderList(scope: string) {
  const ids = [reminderIdentifier(scope, 'once'), reminderIdentifier(scope, 'daily')];
  return (await Notifications.getAllScheduledNotificationsAsync()).filter((item) =>
    ids.includes(item.identifier),
  );
}
export function cancelStudyReminders(scope: string) {
  return serial(scope, async () => {
    const results = await Promise.allSettled(
      (['once', 'daily'] as const).flatMap((kind) => {
        const id = reminderIdentifier(scope, kind);
        return [
          Notifications.cancelScheduledNotificationAsync(id),
          Notifications.dismissNotificationAsync(id),
        ];
      }),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('部分本机提醒未能清理，请重试取消');
  });
}
export function scheduleStudyReminder(
  scope: string,
  plan: { kind: 'once'; seconds: number } | { kind: 'daily'; hour: number; minute: number },
  active: () => boolean,
) {
  return serial(scope, async () => {
    initializeStudyNotificationHandler();
    if (!active()) throw new Error('登录身份已变化');
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync(channelId, {
        name: '本机学习提醒',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        sound: null,
      });
    const permissions = await Notifications.getPermissionsAsync();
    const granted = permissions.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) throw new Error('通知权限未开启，请在系统设置中允许知学通知后再试');
    if (!active()) throw new Error('登录身份已变化');
    if (
      plan.kind === 'once' &&
      (!Number.isInteger(plan.seconds) || plan.seconds < 10 || plan.seconds > 86400)
    )
      throw new Error('提醒需在10秒至24小时内');
    const trigger: Notifications.NotificationTriggerInput =
      plan.kind === 'once'
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: plan.seconds,
            repeats: false,
            channelId,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            ...reminderTime(plan.hour, plan.minute),
            channelId,
          };
    const identifier = reminderIdentifier(scope, plan.kind);
    await Notifications.cancelScheduledNotificationAsync(identifier);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { ...reminderContent, sound: false, data: { kind: 'local-study-reminder' } },
      trigger,
    });
    if (!active()) {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      throw new Error('登录身份已变化，提醒已取消');
    }
    return identifier;
  });
}
/** Mount once in the authenticated shell, not just on the reminder/offline screens. */
export function bindPersonalDeviceLearning(client: MobileClient, user: MobileUser) {
  let disposed = false;
  const scope = deviceLearningScope(client.origin, user);
  const clear = () => {
    if (disposed) return;
    disposed = true;
    void scope
      .then(async (value) => {
        await Promise.allSettled([cancelStudyReminders(value), clearOfflineIdentity(value)]);
      })
      .catch(() => undefined);
  };
  const off = client.onSessionInvalidated(clear);
  return () => {
    off();
    clear();
  };
}
