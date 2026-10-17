/** Serializes the process-wide native audio session across rapid room replacement. */
export class AudioSessionLease {
  private owner: symbol | undefined;
  private work: Promise<unknown> = Promise.resolve();
  acquire(start: () => Promise<void>, stop: () => Promise<void>) {
    const owner = Symbol('room-audio');
    this.owner = owner;
    const ready = this.work
      .catch(() => undefined)
      .then(async () => {
        if (this.owner !== owner) return false;
        await start();
        return this.owner === owner;
      });
    this.work = ready;
    return {
      ready,
      release: () => {
        if (this.owner === owner) this.owner = undefined;
        const work = this.work
          .catch(() => undefined)
          .then(async () => {
            if (this.owner === undefined) await stop();
          });
        this.work = work;
        return work;
      },
    };
  }
}
