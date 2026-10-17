import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource } from 'livekit-server-sdk';
import { readLiveConfiguration } from './live.config';

export function publicationPermission(approved: boolean, host: boolean) {
  return {
    canPublish: approved,
    canSubscribe: true,
    canPublishData: false,
    canUpdateMetadata: false,
    canPublishSources: approved
      ? [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          ...(host ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
        ]
      : [],
  };
}

@Injectable()
export class LiveMedia {
  private client() {
    const c = readLiveConfiguration();
    return new RoomServiceClient(c.serverUrl, c.apiKey, c.apiSecret, { requestTimeout: 5, failover: false });
  }
  async token(
    room: string,
    identity: string,
    name: string,
    approved: boolean,
    host: boolean,
    connectionId: string,
    mobileSessionId?: string,
  ) {
    const c = readLiveConfiguration();
    const token = new AccessToken(c.apiKey, c.apiSecret, {
      identity,
      name,
      ttl: 60,
      metadata: JSON.stringify({ connectionId, ...(mobileSessionId ? { mobileSessionId } : {}) }),
    });
    const p = publicationPermission(approved, host);
    token.addGrant({
      roomJoin: true,
      room,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
      canPublish: p.canPublish,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: p.canPublishSources,
    });
    return token.toJwt();
  }
  async verify(token: string) {
    const c = readLiveConfiguration();
    return new TokenVerifier(c.apiKey, c.apiSecret).verify(token, 0);
  }
  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      throw new ServiceUnavailableException('直播音视频服务暂不可用，请稍后重试');
    }
  }
  create(name: string, maxParticipants: number) {
    return this.safe(() =>
      this.client().createRoom({ name, maxParticipants, emptyTimeout: 600, departureTimeout: 30 }),
    );
  }
  async remove(room: string, identity: string) {
    try {
      await this.client().removeParticipant(room, identity);
    } catch (error) {
      if ((error as { code?: string }).code !== 'not_found')
        throw new ServiceUnavailableException('成员连接清理暂未完成，请重试');
    }
  }
  async permission(room: string, identity: string, approved: boolean, host: boolean) {
    try {
      await this.client().updateParticipant(room, identity, {
        permission: publicationPermission(approved, host),
      });
    } catch (error) {
      // A member may already have disconnected; their next admission reads the database again.
      if ((error as { code?: string }).code !== 'not_found')
        throw new ServiceUnavailableException('连麦权限同步失败，请重试');
    }
  }
  async end(room: string) {
    try {
      await this.client().deleteRoom(room);
    } catch (error) {
      if ((error as { code?: string }).code !== 'not_found')
        throw new ServiceUnavailableException('课堂连接清理暂未完成，请重试结束课堂');
    }
  }
}
