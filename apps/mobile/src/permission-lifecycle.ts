/** Permission overlays pause Android activities; only their own classroom may defer background leave. */
export class PermissionPromptLease {
  private owners = new Map<string, number>();
  private listeners = new Set<() => void>();
  activeFor(owner?: string) {
    return !!owner && (this.owners.get(owner) || 0) > 0;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  begin(owner: string) {
    this.owners.set(owner, (this.owners.get(owner) || 0) + 1);
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.owners.get(owner) || 1) - 1;
      if (count) this.owners.set(owner, count);
      else this.owners.delete(owner);
      this.notify();
    };
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
}
export const permissionPrompts = new PermissionPromptLease();
