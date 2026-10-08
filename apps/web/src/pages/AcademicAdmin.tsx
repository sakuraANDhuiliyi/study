import { useState } from 'react';
import { Alert, App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd';
import { Plus } from 'lucide-react';
import { useAuth } from '../auth';
import { ApiError, send, useData } from '../api';
import { PageTitle, Panel, QueryState } from '../components/shared';
import { JoinAdministration } from '../components/academics/JoinAdministration';
import type { Catalog, Major, Subject } from '../components/academics/types';
import '../academics.css';
type Editing = { type: 'subjects' | 'majors'; record?: Subject | Major; clone?: boolean };
export function AcademicAdmin() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const subjects = useData<{ items: Subject[] }>('/academics/admin/subjects');
  const majors = useData<{ items: Major[] }>('/academics/admin/majors');
  const catalog = useData<Catalog>('/academics/catalog');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function open(type: Editing['type'], record?: Subject | Major, clone = false) {
    setEditing({ type, record, clone });
    setError('');
    form.resetFields();
    form.setFieldsValue(
      record ? { ...record, name: clone ? `${record.name}（副本）` : record.name } : { moduleIds: [] },
    );
  }
  async function save(values: {
    name: string;
    description?: string;
    subjectId?: string;
    moduleIds?: string[];
  }) {
    if (!editing) return;
    setBusy(true);
    setError('');
    const update = editing.record && !editing.clone;
    try {
      await send(
        `/academics/admin/${editing.type}${update ? `/${editing.record!.id}` : ''}`,
        {
          name: values.name,
          description: values.description || '',
          ...(editing.type === 'majors'
            ? { subjectId: values.subjectId, moduleIds: values.moduleIds || [] }
            : {}),
          ...(update ? { revision: editing.record!.revision } : {}),
        },
        update ? 'PATCH' : 'POST',
      );
      await Promise.all([subjects.refetch(), majors.refetch(), catalog.refetch()]);
      setEditing(null);
      message.success('专业目录已保存');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? '目录已被其他管理员修改。输入已保留，请复制需要的内容，关闭后刷新列表再编辑。'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function active(type: Editing['type'], record: Subject | Major) {
    try {
      await send(
        `/academics/admin/${type}/${record.id}`,
        { revision: record.revision, active: !record.active },
        'PATCH',
      );
      await Promise.all([subjects.refetch(), majors.refetch(), catalog.refetch()]);
      message.success(record.active ? '已归档，历史学习记录保留' : '已恢复使用');
    } catch (err) {
      message.error((err as Error).message);
    }
  }
  const columns = (type: Editing['type']) => [
    {
      title: type === 'subjects' ? '学科名称' : '专业名称',
      dataIndex: 'name',
      render: (value: string, record: Subject) => (
        <div>
          <strong>{value}</strong>
          <p className="table-secondary">{record.description}</p>
        </div>
      ),
    },
    ...(type === 'majors'
      ? [
          {
            title: '所属学科',
            dataIndex: 'subjectId',
            render: (value: string) => subjects.data?.items.find((item) => item.id === value)?.name || '—',
          },
          {
            title: '推荐模块',
            dataIndex: 'moduleIds',
            render: (value: string[]) => `${value?.length || 0} 个`,
          },
        ]
      : []),
    {
      title: '来源',
      dataIndex: 'organizationId',
      render: (value: string | null) => (
        <Tag color={value ? 'blue' : 'default'}>{value ? '本组织自建' : '平台模板'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'active',
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'default'}>{value ? '使用中' : '已归档'}</Tag>
      ),
    },
    {
      title: '操作',
      render: (_: unknown, record: Subject | Major) => (
        <Space wrap>
          <Button type="link" onClick={() => open(type, record, true)}>
            复制新建
          </Button>
          {record.organizationId === user?.organizationId && (
            <>
              <Button type="link" onClick={() => open(type, record)}>
                编辑
              </Button>
              <Popconfirm
                title={record.active ? '归档后不再用于新选择，已有引用和记录保留。' : '恢复此目录项？'}
                onConfirm={() => active(type, record)}
              >
                <Button type="link" danger={record.active}>
                  {record.active ? '归档' : '恢复'}
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];
  return (
    <div className="academic-page">
      <PageTitle
        eyebrow="ACADEMIC ADMINISTRATION"
        title="学科、专业与成员申请"
        description="维护本组织专业方向与推荐学习模块，审核个人用户的加入申请。"
      />
      <Tabs
        items={[
          {
            key: 'majors',
            label: '专业管理',
            children: (
              <Panel
                title="专业目录"
                description="平台模板可直接使用；复制后可定制本组织专属学习模块。"
                extra={
                  <Button type="primary" icon={<Plus size={16} />} onClick={() => open('majors')}>
                    新建专业
                  </Button>
                }
              >
                <QueryState query={majors}>
                  <Table
                    rowKey="id"
                    dataSource={majors.data?.items || []}
                    columns={columns('majors')}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 850 }}
                  />
                </QueryState>
              </Panel>
            ),
          },
          {
            key: 'subjects',
            label: '学科管理',
            children: (
              <Panel
                title="学科目录"
                extra={
                  <Button type="primary" icon={<Plus size={16} />} onClick={() => open('subjects')}>
                    新建学科
                  </Button>
                }
              >
                <QueryState query={subjects}>
                  <Table
                    rowKey="id"
                    dataSource={subjects.data?.items || []}
                    columns={columns('subjects')}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 700 }}
                  />
                </QueryState>
              </Panel>
            ),
          },
          ...(['org.manage', 'users.manage'].every((permission) => user?.permissions.includes(permission))
            ? [
                {
                  key: 'requests',
                  label: '邀请码与加入审批',
                  children: <JoinAdministration majors={majors.data?.items || []} />,
                },
              ]
            : []),
        ]}
      />
      <Modal
        open={!!editing}
        title={`${editing?.record && !editing.clone ? '编辑' : '新建'}${editing?.type === 'subjects' ? '学科' : '专业'}`}
        width={640}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="name" label="名称" rules={[{ required: true }, { max: 100 }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="介绍">
            <Input.TextArea rows={4} maxLength={3000} />
          </Form.Item>
          {editing?.type === 'majors' && (
            <>
              <Form.Item
                name="subjectId"
                label="所属学科"
                rules={[{ required: true, message: '请选择所属学科' }]}
              >
                <Select
                  options={subjects.data?.items
                    .filter(
                      (item) => item.active || item.id === (editing.record as Major | undefined)?.subjectId,
                    )
                    .map((item) => ({ value: item.id, label: item.name }))}
                />
              </Form.Item>
              <Form.Item
                name="moduleIds"
                label="推荐学习模块"
                extra="推荐模块用于学生的专业学习空间；学生仍可自行添加其他模块。"
              >
                <Select
                  mode="multiple"
                  showSearch
                  optionFilterProp="label"
                  options={catalog.data?.modules.map((item) => ({ value: item.id, label: item.title }))}
                />
              </Form.Item>
            </>
          )}
          {error && <Alert type="error" showIcon message="保存失败" description={error} />}
        </Form>
      </Modal>
    </div>
  );
}
