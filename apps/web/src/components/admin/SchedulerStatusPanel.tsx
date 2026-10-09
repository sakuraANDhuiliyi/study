import { useId } from 'react';
import { Alert } from 'antd';
import './scheduler-status.css';

type Lifecycle = 'not_initialized' | 'disabled' | 'scheduled' | 'stopped';
type Snapshot = {
  automaticEnabled: boolean;
  lifecycle: Lifecycle;
  pollIntervalMs: number;
  pollInProgress: boolean;
};
type SchedulerStatus = {
  scope: 'responding_api_instance';
  observedAt: string;
  common: Snapshot;
  examDeadline: Snapshot;
};
const lifecycleLabels: Record<Lifecycle, string> = {
  not_initialized: '尚未初始化',
  disabled: '自动调度关闭',
  scheduled: '已注册自动调度',
  stopped: '已停止后续调度',
};
function snapshot(value: unknown, interval: number): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Snapshot>;
  return (
    typeof row.automaticEnabled === 'boolean' &&
    typeof row.pollInProgress === 'boolean' &&
    row.pollIntervalMs === interval &&
    typeof row.lifecycle === 'string' &&
    Object.prototype.hasOwnProperty.call(lifecycleLabels, row.lifecycle)
  );
}
function status(value: unknown): value is SchedulerStatus {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SchedulerStatus>;
  return (
    row.scope === 'responding_api_instance' &&
    typeof row.observedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row.observedAt) &&
    Number.isFinite(Date.parse(row.observedAt)) &&
    snapshot(row.common, 5000) &&
    snapshot(row.examDeadline, 10000)
  );
}
function observed(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
/** Parent renders only within current platform-authorized Jobs data. No own requests or controls. */
export function SchedulerStatusPanel({ value }: { value: unknown }) {
  const heading = useId();
  if (value === undefined) return null;
  return (
    <section className="scheduler-status-panel" aria-labelledby={heading}>
      <h3 id={heading}>当前响应 API 实例调度</h3>
      {!status(value) ? (
        <Alert type="warning" showIcon message="本实例调度状态暂不可用" />
      ) : (
        <>
          <p role="status" aria-label="调度状态观测时间">
            本实例观测时间：{observed(value.observedAt)}（北京时间）；与任务统计时间分别记录。
          </p>
          <div className="scheduler-status-grid">
            {(
              [
                { key: 'common', label: '通用任务自动调度' },
                { key: 'examDeadline', label: '考试截止自动调度' },
              ] as const
            ).map(({ key, label }) => {
              const item = value[key];
              return (
                <div key={key} role="status" aria-label={label}>
                  <strong>{label}</strong>
                  <dl>
                    <div>
                      <dt>启动时自动调度</dt>
                      <dd>{item.automaticEnabled ? '开启' : '关闭'}</dd>
                    </div>
                    <div>
                      <dt>生命周期</dt>
                      <dd>{lifecycleLabels[item.lifecycle]}</dd>
                    </div>
                    <div>
                      <dt>轮询</dt>
                      <dd>{item.pollInProgress ? '一次轮询进行中' : '当前没有轮询执行'}</dd>
                    </div>
                    <div>
                      <dt>配置轮询间隔</dt>
                      <dd>{item.pollIntervalMs / 1000} 秒</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="scheduler-status-note">
        仅反映返回本页数据的 API 实例，其他实例可能继续处理共享任务。这些状态不能证明任务成功或全平台健康。
        启动配置不是实时开关；停止后仍可能有在途轮询收尾。轮询进行中不等于某条任务正在执行。
      </p>
    </section>
  );
}
