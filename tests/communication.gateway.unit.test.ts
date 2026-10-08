import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationSessions as CommunicationGateway } from '../apps/api/src/communication/socket-sessions';
import type { Socket } from 'socket.io';
import type { AuthService } from '../apps/api/src/auth/auth.service';

const actor = { id: 'student', organizationId: 'org', csrfToken: 'csrf', permissions: [] };
function fakeSocket(id: string, gateway: CommunicationGateway) {
  const events: string[] = [];
  const socket = {
    id,
    connected: true,
    handshake: {
      headers: {
        origin: process.env.APP_ORIGIN || 'http://localhost:5173',
        cookie: 'lms_session=test-token',
      },
      auth: { csrfToken: 'csrf' },
    },
    join: async () => {},
    emit: (event: string) => events.push(event),
    disconnect: () => {
      socket.connected = false;
      gateway.handleDisconnect(socket as unknown as Socket);
    },
  };
  return { socket: socket as unknown as Socket, events };
}

test('WebSocket鉴权等待期间断开不会留下ready事件或活跃会话', async () => {
  let release!: (value: typeof actor) => void;
  const pending = new Promise<typeof actor>((resolve) => {
    release = resolve;
  });
  const gateway = new CommunicationGateway({ resolveSession: () => pending } as unknown as AuthService);
  const { socket, events } = fakeSocket('disconnect-race', gateway);
  try {
    const connecting = gateway.handleConnection(socket);
    socket.disconnect(true);
    release(actor);
    await connecting;
    assert.deepEqual(events, []);
    assert.equal((gateway as any).sessions.size, 0);
  } finally {
    socket.disconnect(true);
  }
});

test('同一Socket重叠失效通知共享一次当前授权查询', async () => {
  let queries = 0;
  let pending: Promise<typeof actor> | undefined;
  let release!: (value: typeof actor) => void;
  const gateway = new CommunicationGateway({
    resolveSession: async () => {
      queries++;
      return pending || actor;
    },
  } as unknown as AuthService);
  const { socket, events } = fakeSocket('coalesced', gateway);
  (gateway as any).server = { sockets: new Map([[socket.id, socket]]) };
  try {
    await gateway.handleConnection(socket);
    const before = queries;
    pending = new Promise<typeof actor>((resolve) => {
      release = resolve;
    });
    const first = gateway.invalidate([actor.id]);
    const second = gateway.invalidate([actor.id]);
    assert.equal(queries - before, 1);
    release(actor);
    await Promise.all([first, second]);
    assert.equal(events.filter((event) => event === 'invalidate').length, 1);
  } finally {
    if (release) release(actor);
    socket.disconnect(true);
  }
});

test('WebSocket默认允许20个同用户标签页，超额连接不登记；释放后可重连', async () => {
  const old = process.env.MAX_WEBSOCKETS_PER_USER;
  process.env.MAX_WEBSOCKETS_PER_USER = '20';
  const gateway = new CommunicationGateway({ resolveSession: async () => actor } as unknown as AuthService);
  const sockets = Array.from({ length: 22 }, (_, i) => fakeSocket(`tab-${i}`, gateway));
  try {
    await Promise.all(sockets.slice(0, 21).map(({ socket }) => gateway.handleConnection(socket)));
    assert.equal(sockets.slice(0, 21).filter(({ socket }) => socket.connected).length, 20);
    assert.equal((gateway as any).sessions.size, 20);
    sockets.find(({ socket }) => socket.connected)!.socket.disconnect(true);
    await gateway.handleConnection(sockets[21].socket);
    assert.equal(sockets[21].socket.connected, true);
    assert.equal((gateway as any).sessions.size, 20);
  } finally {
    sockets.forEach(({ socket }) => socket.disconnect(true));
    if (old === undefined) delete process.env.MAX_WEBSOCKETS_PER_USER;
    else process.env.MAX_WEBSOCKETS_PER_USER = old;
  }
});
