import { Injectable, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class LiveConnections implements OnModuleDestroy {
  readonly entries = new Map<
    string,
    { memberId: string; liveId: string; connectionId: string; close: () => void }
  >();
  closeMember(id: string, connectionId?: string) {
    for (const entry of this.entries.values())
      if (entry.memberId === id && (!connectionId || entry.connectionId === connectionId)) entry.close();
  }
  closeClass(id: string) {
    for (const entry of this.entries.values()) if (entry.liveId === id) entry.close();
  }
  onModuleDestroy() {
    for (const entry of this.entries.values()) entry.close();
    this.entries.clear();
  }
}
