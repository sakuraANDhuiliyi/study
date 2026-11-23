import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { expoPushToken } from './mobile-push.schemas';
export type PushOutcome =
  | { kind: 'ticket'; id: string }
  | { kind: 'delivered' }
  | { kind: 'retry' | 'failed' | 'unknown'; code: string; disable?: boolean };
export function mobilePushConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.MOBILE_PUSH_ENABLED === 'true',
    projectId = env.MOBILE_PUSH_EXPO_PROJECT_ID || '',
    encoded = env.MOBILE_PUSH_TOKEN_KEY || '';
  const key = /^[A-Za-z0-9+/]{43}=$/.test(encoded) ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  const available =
    enabled &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) &&
    key.length === 32;
  return {
    available,
    projectId: available ? projectId : null,
    key,
    accessToken: env.MOBILE_PUSH_EXPO_ACCESS_TOKEN || '',
    reason: !enabled ? '服务器未启用远程学习通知' : available ? '' : '远程通知配置尚未完成',
  };
}
export const pushTokenHash = (token: string) =>
  createHash('sha256').update(expoPushToken.parse(token)).digest('hex');
export function sealPushToken(token: string, key: Buffer) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('zhixue-mobile-push-v1'));
  const bytes = Buffer.concat([cipher.update(expoPushToken.parse(token), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
}
export function openPushToken(ciphertext: string, key: Buffer) {
  const b = Buffer.from(ciphertext, 'base64');
  if (b.length < 29 || b.length > 1024) throw new Error('PUSH_TOKEN_INVALID');
  const cipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  cipher.setAAD(Buffer.from('zhixue-mobile-push-v1'));
  cipher.setAuthTag(b.subarray(12, 28));
  return expoPushToken.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8'));
}
export const remotePushContent = {
  title: '知学 · 学习通知',
  body: '你有新的学习动态，请打开平台查看。',
  sound: null,
  channelId: 'remote-study-inbox',
  ttl: 3600,
};
function failure(code: unknown): PushOutcome {
  if (code === 'DeviceNotRegistered') return { kind: 'failed', code: 'DEVICE_NOT_REGISTERED', disable: true };
  if (code === 'MessageRateExceeded') return { kind: 'retry', code: 'RATE_LIMITED' };
  return {
    kind: 'failed',
    code: code === 'InvalidCredentials' ? 'INVALID_CREDENTIALS' : 'PROVIDER_REJECTED',
  };
}
@Injectable()
export class MobilePushGateway {
  status() {
    const c = mobilePushConfig();
    return { available: c.available, projectId: c.projectId, reason: c.reason };
  }
  async send(token: string, bindingId: string): Promise<PushOutcome> {
    return this.request(
      'send',
      { to: expoPushToken.parse(token), ...remotePushContent, data: { kind: 'study-inbox', bindingId } },
      false,
    );
  }
  async receipt(id: string): Promise<PushOutcome> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return { kind: 'failed', code: 'TICKET_INVALID' };
    return this.request('getReceipts', { ids: [id] }, true, id);
  }
  private async request(
    action: 'send' | 'getReceipts',
    body: unknown,
    receipt: boolean,
    ticketId?: string,
  ): Promise<PushOutcome> {
    const c = mobilePushConfig();
    if (!c.available) return { kind: 'failed', code: 'PROVIDER_DISABLED' };
    let response: Response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/' + action, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(c.accessToken ? { authorization: 'Bearer ' + c.accessToken } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      return { kind: receipt ? 'retry' : 'unknown', code: 'TRANSPORT_UNCERTAIN' };
    }
    if (response.status === 429) return { kind: 'retry', code: 'RATE_LIMITED' };
    if (!response.ok)
      return {
        kind: receipt && response.status >= 500 ? 'retry' : response.status >= 500 ? 'unknown' : 'failed',
        code: 'PROVIDER_HTTP_ERROR',
      };
    try {
      if (Number(response.headers.get('content-length') || 0) > 65536) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(r.value);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')),
        data = receipt ? value?.data?.[ticketId!] : Array.isArray(value?.data) ? value.data[0] : value?.data;
      if (receipt && !data) return { kind: 'retry', code: 'RECEIPT_PENDING' };
      if (data?.status === 'error') return failure(data.details?.error);
      if (data?.status !== 'ok') throw new Error();
      if (receipt) return { kind: 'delivered' };
      if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(data.id)) throw new Error();
      return { kind: 'ticket', id: data.id };
    } catch {
      return { kind: receipt ? 'retry' : 'unknown', code: 'INVALID_RESPONSE' };
    }
  }
}
