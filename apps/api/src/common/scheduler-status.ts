export type SchedulerLifecycle = 'not_initialized' | 'disabled' | 'scheduled' | 'stopped';
export type SchedulerSnapshot = {
  automaticEnabled: boolean;
  lifecycle: SchedulerLifecycle;
  pollIntervalMs: number;
  pollInProgress: boolean;
};

// A policy/pass observation for the responding instance, not queue health or a
// cluster assertion. Keep provider and API DTOs explicitly allowlisted.
export function schedulerSnapshotDto(snapshot: SchedulerSnapshot): SchedulerSnapshot {
  return {
    automaticEnabled: snapshot.automaticEnabled,
    lifecycle: snapshot.lifecycle,
    pollIntervalMs: snapshot.pollIntervalMs,
    pollInProgress: snapshot.pollInProgress,
  };
}
