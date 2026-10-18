import type { MobileClient } from './client';
import type { AnswerValue } from './assignment-model';
export type SubmissionBody = {
  answers: { questionVersionId: string; value: AnswerValue }[];
  attachmentIds: string[];
  idempotencyKey: string;
  expectedDraftRevision: number;
  expectedSubmissionVersion: number;
};
export type PendingSubmission = { epoch: number; body: SubmissionBody };
const ledgers = new WeakMap<MobileClient, Map<string, PendingSubmission>>();
function ledger(client: MobileClient) {
  let map = ledgers.get(client);
  if (!map) {
    map = new Map();
    ledgers.set(client, map);
    client.onSessionInvalidated(() => map!.clear());
  }
  return map;
}
export function pendingSubmission(client: MobileClient, id: string) {
  const pending = ledger(client).get(id);
  if (pending && client.ownsSession(pending.epoch)) return pending;
  ledger(client).delete(id);
  return null;
}
export function rememberSubmission(client: MobileClient, id: string, body: SubmissionBody) {
  const map = ledger(client);
  if (!map.has(id) && map.size >= 10) throw new Error('存在较多未确认的提交，请先核对已有提交结果。');
  const pending = { epoch: client.sessionEpoch(), body: JSON.parse(JSON.stringify(body)) as SubmissionBody };
  map.set(id, pending);
  return pending;
}
export function forgetSubmission(client: MobileClient, id: string) {
  ledger(client).delete(id);
}
