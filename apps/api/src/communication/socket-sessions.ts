import type { Namespace, Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service';
import { sameSecret, validSocketOrigin } from './security';

/** Transport-independent lifecycle logic, also exercised without a live Nest server. */
export class CommunicationSessions {
  private readonly sessions = new Map<
    string,
    { token: string; userId: string; organizationId: string; timer: NodeJS.Timeout; validating: boolean }
  >();
  server!: Namespace;
  constructor(private readonly auth: Pick<AuthService, 'resolveSession'>) {}

  private connectionLimit(value: string | undefined, fallback: number, max: number) {
    const configured = Number(value);
    return Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, max) : fallback;
  }
  private hasCapacity(userId?: string) {
    if (this.sessions.size >= this.connectionLimit(process.env.MAX_WEBSOCKETS_TOTAL, 2000, 10000))
      return false;
    return (
      !userId ||
      [...this.sessions.values()].filter((entry) => entry.userId === userId).length <
        this.connectionLimit(process.env.MAX_WEBSOCKETS_PER_USER, 20, 100)
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      if (!socket.connected || !this.hasCapacity()) return void socket.disconnect(true);
      const origin = socket.handshake.headers.origin;
      if (!validSocketOrigin(origin, process.env.APP_ORIGIN || 'http://localhost:5173'))
        return void socket.disconnect(true);
      const cookie = socket.handshake.headers.cookie || '';
      const raw = cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('lms_session='));
      const token = raw ? decodeURIComponent(raw.slice('lms_session='.length)) : '';
      const actor = token ? await this.auth.resolveSession(token) : null;
      if (!actor || !sameSecret(actor.csrfToken, socket.handshake.auth?.csrfToken))
        return void socket.disconnect(true);
      if (!socket.connected || !this.hasCapacity(actor.id)) return void socket.disconnect(true);
      // Clients never choose room names or receive unauthorised course subscriptions.
      await socket.join(`user:${actor.organizationId}:${actor.id}`);
      // Disconnect may run while authentication or room admission is awaiting I/O.
      // Recheck immediately before allocating the timer; reservation and registration are synchronous.
      if (!socket.connected || !this.hasCapacity(actor.id)) return void socket.disconnect(true);
      const timer = setInterval(() => {
        void this.validateAndEmit(socket);
      }, 15000);
      timer.unref();
      this.sessions.set(socket.id, {
        token,
        userId: actor.id,
        organizationId: actor.organizationId,
        timer,
        validating: false,
      });
      socket.emit('ready', { userId: actor.id });
    } catch {
      socket.disconnect(true);
    }
  }

  private async validateAndEmit(socket: Socket): Promise<void> {
    const entry = this.sessions.get(socket.id);
    if (!entry || entry.validating) return;
    entry.validating = true;
    try {
      const actor = await this.auth.resolveSession(entry.token);
      if (!socket.connected || this.sessions.get(socket.id) !== entry) return;
      if (
        !actor ||
        actor.id !== entry.userId ||
        actor.organizationId !== entry.organizationId ||
        !sameSecret(actor.csrfToken, socket.handshake.auth?.csrfToken)
      ) {
        socket.disconnect(true);
        return;
      }
      socket.emit('invalidate', { resources: ['notifications', 'conversations', 'messages', 'discussions'] });
    } catch {
      socket.disconnect(true);
    } finally {
      entry.validating = false;
    }
  }

  async invalidate(userIds: string[]): Promise<void> {
    const wanted = new Set(userIds);
    await Promise.all(
      [...this.sessions]
        .filter(([, entry]) => wanted.has(entry.userId))
        .map(async ([socketId]) => {
          const socket = this.server?.sockets.get(socketId);
          if (socket) await this.validateAndEmit(socket);
        }),
    );
  }

  handleDisconnect(socket: Socket): void {
    const entry = this.sessions.get(socket.id);
    if (entry) clearInterval(entry.timer);
    this.sessions.delete(socket.id);
  }
}
