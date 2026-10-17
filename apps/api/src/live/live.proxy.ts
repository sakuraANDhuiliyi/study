import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { LiveService } from './live.service';
import { LiveConnections } from './live.connections';
import { readLiveConfiguration } from './live.config';
import { LIVE_MEDIA_PREFIX } from './live.schemas';
export const LIVE_NATIVE_PREFIX = '/api/live/native-media';
const mediaPrefix = (path: string) =>
  path.startsWith(LIVE_NATIVE_PREFIX + '/') ? LIVE_NATIVE_PREFIX : LIVE_MEDIA_PREFIX;
const mediaRequest = (path: string) =>
  [LIVE_MEDIA_PREFIX, LIVE_NATIVE_PREFIX].some((p) => path.startsWith(p + '/'));

export function liveMediaPath(value: string) {
  if (value.length > 32_768) return null;
  const url = new URL(value, 'http://localhost');
  if (value.split('?')[0] !== url.pathname) return null;
  if (!/^\/api\/live\/(?:media|native-media)\/rtc(?:\/v1)?(?:\/validate)?$/.test(url.pathname)) return null;
  if (url.searchParams.getAll('access_token').length !== 1) return null;
  return url;
}
function sessionCookie(value = '') {
  const matches = value
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith('lms_session='));
  if (matches.length !== 1) return '';
  try {
    return decodeURIComponent(matches[0].slice(12));
  } catch {
    return '';
  }
}

@Injectable()
export class LiveProxy implements OnModuleDestroy {
  private pending = 0;
  private timers = new Set<NodeJS.Timeout>();
  constructor(
    private live: LiveService,
    private connections: LiveConnections,
  ) {}
  private async admit(req: IncomingMessage, checkPublish = true) {
    const url = liveMediaPath(req.url || '');
    if (!url || req.method !== 'GET') throw new Error('invalid request');
    const native = mediaPrefix(url.pathname) === LIVE_NATIVE_PREFIX;
    if (!native && req.headers.origin && req.headers.origin !== process.env.APP_ORIGIN)
      throw new Error('invalid origin');
    if (native && req.headers.cookie) throw new Error('mixed credentials');
    const token = url.searchParams.get('access_token') || '';
    const cookie = sessionCookie(req.headers.cookie);
    const entry = await this.live.admission(token, cookie, checkPublish, native);
    return { ...entry, token, cookie, url, native };
  }
  private target(url: URL) {
    const target = new URL(readLiveConfiguration().serverUrl);
    target.pathname = url.pathname.slice(mediaPrefix(url.pathname).length);
    target.search = url.search;
    return target;
  }
  middleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!mediaRequest(req.path)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (this.pending >= 64) return void res.status(429).end();
    this.pending++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.pending--;
    };
    res.once('finish', release);
    res.once('close', release);
    try {
      const entry = await this.admit(req);
      if (res.destroyed) return;
      if (!entry.url.pathname.endsWith('/validate')) return void res.status(400).end();
      const target = this.target(entry.url);
      const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        { method: 'GET', timeout: 5000, headers: { accept: 'application/json' } },
        (reply) => {
          res.status(reply.statusCode || 502);
          // Only a successful validation body is relevant; never forward provider errors/logs.
          if ((reply.statusCode || 500) >= 400) {
            reply.resume();
            res.end();
          } else {
            res.setHeader('Content-Type', 'text/plain');
            reply.pipe(res);
          }
        },
      );
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      res.on('close', () => upstream.destroy());
      upstream.end();
    } catch {
      res.status(403).end();
    } finally {
      // Count the upstream request until its response finishes, not only admission.
      if (res.writableEnded || res.destroyed) release();
    }
  };
  attach(server: Server) {
    server.on('upgrade', (req, socket, head) => {
      if (!mediaRequest(req.url || '')) {
        // Engine.IO leaves other upgrades alone so the live gateway can handle them.
        // Explicitly reject unknown routes instead of leaving unowned sockets open.
        if (!(req.url || '').startsWith('/socket.io/')) socket.destroy();
        return;
      }
      void this.upgrade(req, socket, head);
    });
  }
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (this.pending >= 64 || this.connections.entries.size >= 1000) {
      socket.destroy();
      return;
    }
    this.pending++;
    socket.pause();
    try {
      const signalPath = liveMediaPath(req.url || '');
      if (!signalPath) throw new Error();
      if (
        mediaPrefix(signalPath.pathname) !== LIVE_NATIVE_PREFIX &&
        (!req.headers.origin || req.headers.origin !== process.env.APP_ORIGIN)
      )
        throw new Error();
      const entry = await this.admit(req);
      if (entry.url.pathname.endsWith('/validate') || socket.destroyed) throw new Error();
      if (
        this.connections.entries.size >= 1000 ||
        [...this.connections.entries.values()].filter((x) => x.memberId === entry.member.id).length >= 2
      )
        throw new Error();
      const target = this.target(entry.url);
      const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
        method: 'GET',
        timeout: 8000,
        headers: {
          host: target.host,
          upgrade: 'websocket',
          connection: 'Upgrade',
          'sec-websocket-key': req.headers['sec-websocket-key'] || '',
          'sec-websocket-version': '13',
        },
      });
      const id = randomUUID();
      let remote: Duplex | undefined;
      let validating = false;
      let closed = false;
      let timer: NodeJS.Timeout | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) {
          clearInterval(timer);
          this.timers.delete(timer);
        }
        this.connections.entries.delete(id);
        socket.destroy();
        remote?.destroy();
        upstream.destroy();
      };
      // Reserve capacity before yielding to the upstream handshake.
      this.connections.entries.set(id, {
        memberId: entry.member.id,
        liveId: entry.room.id,
        connectionId: entry.member.connectionId,
        close,
      });
      socket.once('close', close);
      socket.once('error', close);
      upstream.once('error', close);
      upstream.once('timeout', close);
      upstream.once('response', (reply) => {
        reply.resume();
        close();
      });
      upstream.once('upgrade', async (reply, peer, extra) => {
        remote = peer;
        peer.once('close', close);
        peer.once('error', close);
        try {
          // Close the race between admission and a concurrent end/kick/logout.
          await this.live.admission(entry.token, entry.cookie, true, entry.native);
          if (closed || socket.destroyed) return close();
          upstream.setTimeout(0);
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
              ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol']
                .filter((key) => reply.headers[key])
                .map((key) => `${key}: ${reply.headers[key]}\r\n`)
                .join('') +
              '\r\n',
          );
          if (head.length) peer.write(head);
          if (extra.length) socket.write(extra);
          socket.pipe(peer);
          peer.pipe(socket);
          socket.resume();
          timer = setInterval(async () => {
            if (validating || closed) return;
            validating = true;
            try {
              // Existing sessions are revalidated without treating the original JWT expiry
              // as a session expiry; LiveKit refreshes its own credentials after admission.
              await this.live.connectionAllowed(
                entry.member.id,
                entry.cookie,
                entry.member.connectionId,
                entry.nativeSessionId,
              );
            } catch {
              close();
            } finally {
              validating = false;
            }
          }, 5000);
          timer.unref();
          this.timers.add(timer);
        } catch {
          close();
        }
      });
      upstream.end();
    } catch {
      if (!socket.destroyed)
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } finally {
      this.pending--;
    }
  }
  onModuleDestroy() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }
}
