import { useState } from 'react';
import { Alert, App, Button, Form, Input, Popconfirm, Tag } from 'antd';
import { Building2, LogOut, Send } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { date, send, useData } from '../api';
import { EmptyState, PageTitle, Panel, QueryState } from '../components/shared';
import '../academics.css';
type JoinRequest = {
  id: string;
  organization: { id: string; name: string };
  status: string;
  majorId: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
const statuses: Record<string, string> = {
  PENDING: '等待审核',
  APPROVED: '已通过',
  REJECTED: '未通过',
  CANCELLED: '已撤回',
};
export function OrganizationAccess() {
  const { user } = useAuth();
  return <Membership key={`${user?.organizationId}:${user?.id}`} />;
}
function Membership() {
  const { refresh } = useAuth();
  const client = useQueryClient();
  const { message } = App.useApp();
  const membership = useData<{
    accountMode: 'PERSONAL' | 'ORGANIZATION';
    organization: { id: string; name: string } | null;
    canReturnToPersonal: boolean;
  }>('/account/organization');
  const requests = useData<{ items: JoinRequest[] }>('/account/join-requests');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();
  async function apply(values: { inviteCode: string; note?: string }) {
    setBusy(true);
    setError('');
    try {
      await send('/account/join-requests', { inviteCode: values.inviteCode.trim(), note: values.note || '' });
      form.resetFields();
      await requests.refetch();
      message.success('申请已发送，请等待组织管理员审核');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    try {
      await send(`/account/join-requests/${id}/cancel`);
      await requests.refetch();
      message.success('申请已撤回');
    } catch (err) {
      message.error((err as Error).message);
    }
  }
  async function leave() {
    setBusy(true);
    setError('');
    try {
      await send('/account/leave-organization');
      client.clear();
      await refresh();
      message.success('已返回个人空间，请重新登录');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="academic-page">
      <PageTitle
        eyebrow="MY ORGANIZATION"
        title="我的组织与加入申请"
        description="个人学习可独立进行；加入组织后，可使用管理员授权的课程、班级与教学功能。"
      />
      <QueryState query={membership}>
        <Panel title="当前学习空间">
          <div className="academic-membership">
            <Building2 size={32} />
            <div>
              <h2>{membership.data?.organization?.name || '个人学习空间'}</h2>
              <p>
                {membership.data?.accountMode === 'ORGANIZATION'
                  ? '专业与教学权限由所在组织管理员设置。'
                  : '你可以自由选择专业与学习模块，也可以申请加入组织。'}
              </p>
            </div>
          </div>
          {membership.data?.canReturnToPersonal && (
            <Popconfirm
              title="离开组织并返回个人空间？"
              description="组织课程与教学权限会失效。操作后所有会话退出，需要重新登录。"
              okText="退出组织"
              cancelText="保留当前组织"
              onConfirm={leave}
            >
              <Button danger icon={<LogOut size={16} />} loading={busy}>
                返回个人学习空间
              </Button>
            </Popconfirm>
          )}
        </Panel>
      </QueryState>
      {membership.data?.accountMode === 'PERSONAL' && (
        <Panel
          title="通过邀请码申请加入"
          description="请向组织管理员索取邀请码。提交申请后，由管理员审核并指定专业。"
        >
          <Form form={form} layout="vertical" onFinish={apply} style={{ maxWidth: 600 }}>
            <Form.Item
              name="inviteCode"
              label="组织邀请码"
              rules={[{ required: true, message: '请输入邀请码' }]}
            >
              <Input maxLength={100} placeholder="输入管理员提供的邀请码" autoComplete="off" />
            </Form.Item>
            <Form.Item name="note" label="申请说明（可选）">
              <Input.TextArea
                rows={4}
                maxLength={500}
                showCount
                placeholder="说明你的姓名、班级或加入原因，便于管理员核对。"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<Send size={15} />} loading={busy}>
              提交加入申请
            </Button>
          </Form>
        </Panel>
      )}
      {error && <Alert type="error" showIcon message="操作未完成" description={error} />}
      <Panel title="我的申请记录">
        <QueryState query={requests}>
          {requests.data?.items.length ? (
            <div className="academic-history">
              {requests.data.items.map((request) => (
                <article key={request.id}>
                  <div>
                    <Tag
                      color={
                        request.status === 'APPROVED'
                          ? 'green'
                          : request.status === 'PENDING'
                            ? 'orange'
                            : 'default'
                      }
                    >
                      {statuses[request.status] || request.status}
                    </Tag>
                    <h3>{request.organization.name}</h3>
                    <p>{request.note || '未填写说明'}</p>
                    <small>{date(request.createdAt)}</small>
                  </div>
                  {request.status === 'PENDING' && (
                    <Popconfirm
                      title="撤回这次加入申请？"
                      onConfirm={() => cancel(request.id)}
                      okText="撤回申请"
                      cancelText="取消"
                    >
                      <Button>撤回申请</Button>
                    </Popconfirm>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState description="暂无加入申请" />
          )}
        </QueryState>
      </Panel>
    </div>
  );
}
