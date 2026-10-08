import { useState } from 'react';
import { Alert, App, Button, Input, Pagination, Popconfirm, Select, Space, Switch, Tag } from 'antd';
import { date, queryString, send, useData } from '../../api';
import { EmptyState, Panel, QueryState } from '../shared';
import type { Major } from './types';
type JoinRequest = {
  id: string;
  user: { id: string; name: string; username: string };
  status: string;
  majorId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
export function JoinAdministration({ majors }: { majors: Major[] }) {
  const settings = useData<{ joinEnabled: boolean; inviteCode: string | null }>('/admin/join-settings');
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const requests = useData<{ items: JoinRequest[]; total: number }>(
    `/admin/join-requests?${queryString({ status, page, pageSize: 12 })}`,
  );
  const [selectedMajors, setSelectedMajors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState('');
  const { message } = App.useApp();
  async function settingsAction(body: object, rotate = false) {
    setBusy('settings');
    try {
      await send(
        rotate ? '/admin/join-settings/rotate-code' : '/admin/join-settings',
        body,
        rotate ? 'POST' : 'PATCH',
      );
      await settings.refetch();
      message.success('加入设置已更新');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function decide(request: JoinRequest, state: 'APPROVED' | 'REJECTED') {
    setBusy(request.id);
    try {
      await send(
        `/admin/join-requests/${request.id}`,
        {
          status: state,
          ...(state === 'APPROVED'
            ? {
                majorId:
                  selectedMajors[request.id] === undefined ? request.majorId : selectedMajors[request.id],
              }
            : {}),
        },
        'PATCH',
      );
      await requests.refetch();
      message.success(state === 'APPROVED' ? '已批准加入，申请者需要重新登录' : '申请已驳回');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="academic-admin-stack">
      <Panel title="组织加入设置" description="开启后可向申请者分享邀请码；拥有邀请码仍需管理员审批。">
        <QueryState query={settings}>
          <Space wrap>
            <span>接受加入申请</span>
            <Switch
              aria-label="接受组织加入申请"
              checked={settings.data?.joinEnabled}
              loading={busy === 'settings'}
              onChange={(joinEnabled) => settingsAction({ joinEnabled })}
            />
          </Space>
          {settings.data?.inviteCode && (
            <div className="academic-invite-code">
              <label>
                当前邀请码
                <Input readOnly aria-label="当前组织邀请码" value={settings.data.inviteCode} />
              </label>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(settings.data!.inviteCode!);
                    message.success('邀请码已复制');
                  } catch {
                    message.error('无法访问剪贴板，请手动复制邀请码');
                  }
                }}
              >
                复制邀请码
              </Button>
              <Popconfirm
                title="重新生成邀请码？"
                description="原邀请码会失效，已提交的申请仍可审核。"
                okText="生成新邀请码"
                cancelText="取消"
                onConfirm={() => settingsAction({}, true)}
              >
                <Button loading={busy === 'settings'}>更换邀请码</Button>
              </Popconfirm>
            </div>
          )}
          {!settings.data?.inviteCode && (
            <Button
              style={{ marginTop: 16 }}
              loading={busy === 'settings'}
              onClick={() => settingsAction({}, true)}
            >
              生成组织邀请码
            </Button>
          )}
        </QueryState>
      </Panel>
      <Panel title="成员加入申请">
        <div className="academic-filter-bar">
          <Select
            aria-label="加入申请状态"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'PENDING', label: '等待审核' },
              { value: 'APPROVED', label: '已批准' },
              { value: 'REJECTED', label: '已驳回' },
              { value: 'CANCELLED', label: '已撤回' },
            ]}
          />
          <Button onClick={() => requests.refetch()}>刷新申请</Button>
        </div>
        <Alert
          style={{ marginBottom: 16 }}
          showIcon
          type="info"
          message="批准前请核对身份并指定专业。批准后申请者的全部会话失效，需要重新登录进入组织。"
        />
        <QueryState query={requests}>
          {requests.data?.items.length ? (
            <div className="academic-history">
              {requests.data.items.map((request) => (
                <article key={request.id}>
                  <div>
                    <Tag>
                      {request.status === 'PENDING'
                        ? '待审核'
                        : request.status === 'APPROVED'
                          ? '已批准'
                          : request.status === 'REJECTED'
                            ? '已驳回'
                            : '已撤回'}
                    </Tag>
                    <h3>{request.user.name}</h3>
                    <p>
                      {request.user.username} · {date(request.createdAt)}
                    </p>
                    <p>{request.note || '未填写申请说明'}</p>
                  </div>
                  {request.status === 'PENDING' && (
                    <div className="academic-review-actions">
                      <Select
                        aria-label={`为${request.user.name}指定专业`}
                        allowClear
                        placeholder="指定学生专业（可选）"
                        value={
                          selectedMajors[request.id] === undefined
                            ? request.majorId
                            : selectedMajors[request.id]
                        }
                        options={majors
                          .filter((item) => item.active)
                          .map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) =>
                          setSelectedMajors((current) => ({ ...current, [request.id]: value || null }))
                        }
                      />
                      <Space>
                        <Popconfirm
                          title={`批准${request.user.name}加入本组织？`}
                          okText="批准加入"
                          cancelText="取消"
                          onConfirm={() => decide(request, 'APPROVED')}
                        >
                          <Button type="primary" loading={busy === request.id}>
                            批准加入
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title="驳回这次申请？"
                          okText="驳回申请"
                          cancelText="取消"
                          onConfirm={() => decide(request, 'REJECTED')}
                        >
                          <Button danger loading={busy === request.id}>
                            驳回
                          </Button>
                        </Popconfirm>
                      </Space>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState description="当前没有此状态的申请" />
          )}
          <Pagination
            current={page}
            pageSize={12}
            total={requests.data?.total || 0}
            showSizeChanger={false}
            onChange={setPage}
          />
        </QueryState>
      </Panel>
    </div>
  );
}
