import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import {
  OfflineReviewVault,
  offlineArchive,
  offlineReviewLimits,
  offlineReviewNote,
  personalOfflineIdentity,
  reminderContent,
  reminderIdentifier,
  reminderTime,
  type OfflineVaultPort,
  type OfflineReviewNote,
} from '../apps/mobile/src/offline-review-model';
const scope = (name: string) => createHash('sha256').update(name).digest('hex');
const note = (id = 'note1'): OfflineReviewNote => ({
  id,
  title: '私人标题',
  category: '复习',
  body: '本人笔记 <script>字😀</script>\n',
  revision: 1,
  updatedAt: '2026-11-23T01:00:00.000Z',
  savedAt: '2026-11-23T02:00:00.000Z',
});
function memoryPort() {
  let key: string | null = null,
    blob: Uint8Array | null = null,
    writes = 0,
    decryptions = 0;
  const port: OfflineVaultPort = {
    readKey: async () => key,
    writeKey: async (value) => {
      key = value;
    },
    removeKey: async () => {
      key = null;
    },
    createKey: async () => randomBytes(32).toString('hex'),
    readBlob: async () => blob,
    writeBlob: async (value) => {
      blob = Uint8Array.from(value);
      writes++;
    },
    removeBlob: async () => {
      blob = null;
    },
    encrypt: async (plaintext, secret, aad) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
      cipher.setAAD(Buffer.from(aad));
      return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decrypt: async (ciphertext, secret, aad) => {
      decryptions++;
      const bytes = Buffer.from(ciphertext),
        decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  };
  return { port, key: () => key, blob: () => blob, writes: () => writes, decryptions: () => decryptions };
}
test('offline identity is limited to personal students and partitions server, user, space and role', () => {
  const user = { id: 'u', organizationId: 'o', role: 'STUDENT', accountMode: 'PERSONAL' };
  const first = personalOfflineIdentity('https://school.example', user);
  assert.notEqual(first, personalOfflineIdentity('https://other.example', user));
  assert.notEqual(first, personalOfflineIdentity('https://school.example', { ...user, id: 'other' }));
  assert.notEqual(
    first,
    personalOfflineIdentity('https://school.example', { ...user, organizationId: 'space' }),
  );
  for (const variation of [{ accountMode: 'ORGANIZATION' }, { role: 'TEACHER' }, { role: 'ADMIN' }])
    assert.throws(() => personalOfflineIdentity('https://school.example', { ...user, ...variation }));
});
test('cache stores only ciphertext plus a separate key and returns exact literal note text', async () => {
  const memory = memoryPort(),
    vault = new OfflineReviewVault(scope('alice'), memory.port);
  assert.deepEqual(await vault.list(), []);
  await vault.put(note());
  assert.equal(memory.key()!.length, 64);
  assert.ok(memory.blob());
  assert.ok(!Buffer.from(memory.blob()!).includes(Buffer.from('私人标题')));
  assert.ok(!Buffer.from(memory.blob()!).includes(Buffer.from(note().body)));
  assert.deepEqual(await vault.list(), [note()]);
  const before = Buffer.from(memory.blob()!);
  await vault.put(note());
  assert.notDeepEqual(Buffer.from(memory.blob()!), before, 'fresh GCM nonce for replacement');
  const projected = offlineReviewNote({
    ...note(),
    accessToken: 'secret',
    sourceCode: 'not copied',
    userId: 'not copied',
  });
  assert.deepEqual(
    Object.keys(projected).sort(),
    ['id', 'title', 'category', 'body', 'revision', 'updatedAt', 'savedAt'].sort(),
  );
});
test('copying encrypted blob/key into another account fails GCM associated-data authentication', async () => {
  const memory = memoryPort();
  await new OfflineReviewVault(scope('alice'), memory.port).put(note());
  await assert.rejects(new OfflineReviewVault(scope('bob'), memory.port).list());
  const altered = Uint8Array.from(memory.blob()!);
  altered[15] ^= 1;
  await memory.port.writeBlob(altered);
  await assert.rejects(new OfflineReviewVault(scope('alice'), memory.port).list());
});
test('parallel saves serialize without losing entries and total/size bounds cannot be bypassed', async () => {
  const memory = memoryPort(),
    vault = new OfflineReviewVault(scope('bounded'), memory.port);
  await Promise.all(Array.from({ length: 20 }, (_, index) => vault.put(note('note' + index))));
  assert.equal((await vault.list()).length, 20);
  await assert.rejects(vault.put(note('overflow')), /20/);
  assert.equal((await vault.list()).length, 20);
  await vault.put({ ...note('note0'), body: '更新' });
  assert.equal((await vault.list())[0].body, '更新');
  await vault.remove('note0');
  assert.equal((await vault.list()).length, 19);
  await memory.port.writeBlob(new Uint8Array(offlineReviewLimits.bytes + 1));
  const before = memory.decryptions();
  await assert.rejects(vault.list(), /过大/);
  assert.equal(memory.decryptions(), before);
});
test('logout during key persistence cancels late cache commit and erases both key and ciphertext', async () => {
  const memory = memoryPort();
  let release: (() => void) | undefined, arrived: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      arrived = resolve;
    });
  const port = {
    ...memory.port,
    writeKey: async (value: string) => {
      arrived!();
      await gate;
      await memory.port.writeKey(value);
    },
  };
  const vault = new OfflineReviewVault(scope('race'), port),
    writing = vault.put(note());
  const rejected = assert.rejects(writing, /身份已变化/);
  await seen;
  const cleanup = vault.destroy();
  release!();
  await rejected;
  await cleanup;
  assert.equal(memory.key(), null);
  assert.equal(memory.blob(), null);
  assert.equal(memory.writes(), 0);
  await assert.rejects(vault.list(), /身份已变化/);
});
test('identity cleanup attempts ciphertext deletion even if the native key operation fails', async () => {
  const memory = memoryPort();
  const vault = new OfflineReviewVault(scope('cleanup'), {
    ...memory.port,
    removeKey: async () => {
      throw new Error('native unavailable');
    },
  });
  await vault.put(note());
  await assert.rejects(vault.destroy(), /清除/);
  assert.equal(memory.blob(), null);
});
test('corrupt/duplicate/cross-scope archives and invalid note fields never render as a valid cache', () => {
  const current = scope('archive');
  for (const archive of [
    { version: 1, scope: scope('other'), items: [] },
    { version: 1, scope: current, items: [note(), note()] },
    { version: 2, scope: current, items: [] },
    null,
  ])
    assert.throws(() => offlineArchive(archive, current));
  for (const value of [
    { ...note(), body: '' },
    { ...note(), body: 'x'.repeat(10001) },
    { ...note(), id: '../key' },
    { ...note(), revision: Infinity },
    { ...note(), updatedAt: 'bad' },
    { ...note(), body: '\0' },
  ])
    assert.throws(() => offlineReviewNote(value));
});
test('local reminders use scoped identifiers and generic notification text without private titles or tokens', () => {
  const first = scope('alice'),
    second = scope('bob');
  assert.notEqual(reminderIdentifier(first, 'daily'), reminderIdentifier(second, 'daily'));
  assert.notEqual(reminderIdentifier(first, 'daily'), reminderIdentifier(first, 'once'));
  assert.throws(() => reminderIdentifier('../bad', 'daily'));
  assert.deepEqual(reminderTime(0, 0), { hour: 0, minute: 0 });
  assert.deepEqual(reminderTime(23, 59), { hour: 23, minute: 59 });
  for (const [hour, minute] of [
    [24, 0],
    [-1, 0],
    [12, 60],
    [12, 0.5],
    [NaN, 0],
    ['20', 0],
  ])
    assert.throws(() => reminderTime(hour, minute));
  assert.deepEqual(Object.keys(reminderContent).sort(), ['body', 'title']);
  assert.ok(!JSON.stringify(reminderContent).includes(note().title));
});
