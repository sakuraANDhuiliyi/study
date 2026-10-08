import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  AutoComplete,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import { Plus, Download, Upload as UploadIcon } from 'lucide-react';
import { useAuth } from '../auth';
import { RemoteSelect } from '../components/RemoteSelect';
import { date, label, queryString, send, useAction, useData } from '../api';
import { PageTitle, Panel, QueryState, Status } from '../components/shared';
import type { Major } from '../components/academics/types';
export function AdminUsers() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string>();
  const [majorId, setMajorId] = useState<string>();
  const majors = useData<{ items: Major[] }>('/academics/admin/majors');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const query = useData(`/admin/users?${queryString({ search, role, majorId, page, pageSize: 15 })}`);
  const action = useAction('账号信息已保存');
  const [modal, setModal] = useState<any>(null);
  const [form] = Form.useForm();
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<any>();
  const [importBusy, setImportBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const { message, modal: feedbackModal } = App.useApp();
  const roles = ['STUDENT', 'TEACHER', ...(user?.role === 'SUPER_ADMIN' ? ['ADMIN'] : [])];
  function open(record: any = {}) {
    setModal(record);
    form.resetFields();
    form.setFieldsValue({
      ...record,
      roles: record.roles?.map((x: any) => (typeof x === 'string' ? x : x.role?.name || x.name)) || [
        'STUDENT',
      ],
    });
  }
  async function batch(active: boolean) {
    const result = await action.mutateAsync({
      path: '/admin/users/batch',
      body: { ids: selectedIds, active },
    });
    setSelectedIds([]);
    feedbackModal.info({
      title: '批量处理结果',
      width: 650,
      content: (
        <Table
          rowKey="id"
          dataSource={result.results || []}
          columns={[
            { title: '账号标识', dataIndex: 'id' },
            { title: '结果', dataIndex: 'ok', render: (v) => (v ? '成功' : '失败') },
            { title: '失败原因', dataIndex: 'error' },
          ]}
          pagination={{ pageSize: 8 }}
        />
      ),
    });
  }
  async function save(values: any) {
    if (!values.password) delete values.password;
    await action.mutateAsync({
      path: `/admin/users${modal.id ? `/${modal.id}` : ''}`,
      method: modal.id ? 'PATCH' : 'POST',
      body: values,
    });
    setModal(null);
  }
  async function recoverAccount() {
    setRecoveryBusy(true);
    try {
      await send(`/admin/users/${modal.id}/recovery`);
      message.success('恢复许可已开启。本人须在 15 分钟内使用预留恢复码设置新密码。');
      setModal(null);
      await query.refetch();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setRecoveryBusy(false);
    }
  }
  async function importData(commit = false) {
    setImportBusy(true);
    try {
      const parsed = parseCsv(csv);
      const headers = parsed.shift() || [];
      const rows = parsed
        .filter((row) => row.some(Boolean))
        .map((row) => {
          const item: any = Object.fromEntries(headers.map((h, i) => [h.trim(), row[i]?.trim() || '']));
          item.roles = (item.roles || item.role || 'STUDENT').split('|');
          delete item.role;
          if (!item.majorId) delete item.majorId;
          return item;
        });
      const result = await send('/admin/users/import', { rows, commit });
      if (commit && !result.committed) {
        setPreview(result);
        message.error('导入校验未通过，请修正错误后重新提交');
        return;
      }
      if (commit) {
        message.success(`导入完成：成功 ${result.total ?? 0} 条`);
        setImportOpen(false);
        query.refetch();
        setPreview(null);
      } else setPreview(result);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ACCOUNT MANAGEMENT"
        title="用户管理"
        description="维护机构成员账号、角色与使用状态，保留完整授权记录。"
        extra={
          <Space>
            {user?.permissions.includes('data.export') && (
              <Button href="/api/admin/users/export" icon={<Download size={15} />}>
                导出用户
              </Button>
            )}
            <Button icon={<UploadIcon size={15} />} onClick={() => setImportOpen(true)}>
              批量导入
            </Button>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => open()}>
              新增用户
            </Button>
          </Space>
        }
      />
      <div className="filter-bar">
        <Input.Search
          allowClear
          placeholder="搜索姓名或账号"
          style={{ maxWidth: 310 }}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder="全部角色"
          style={{ width: 145 }}
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN'].map((value) => ({
            value,
            label: label(value),
          }))}
        />
        <span className="filter-count">共 {query.data?.total || 0} 位用户</span>
        <Select
          aria-label="学生专业筛选"
          allowClear
          placeholder="全部专业"
          style={{ width: 190 }}
          value={majorId}
          onChange={(value) => {
            setMajorId(value);
            setPage(1);
          }}
          options={majors.data?.items.map((item) => ({ value: item.id, label: item.name }))}
        />
        {selectedIds.length > 0 && (
          <Space>
            <span className="form-hint" style={{ margin: 0 }}>
              已选 {selectedIds.length}
            </span>
            <Button
              onClick={() => batch(true)}
              loading={action.isPending}
              disabled={selectedIds.length > 100}
            >
              批量启用
            </Button>
            <Popconfirm title="确认停用所选账号？后端逐项校验并返回结果。" onConfirm={() => batch(false)}>
              <Button danger loading={action.isPending} disabled={selectedIds.length > 100}>
                批量停用
              </Button>
            </Popconfirm>
          </Space>
        )}
      </div>
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedIds,
              preserveSelectedRowKeys: true,
              onChange: (keys) => setSelectedIds(keys as string[]),
              getCheckboxProps: (r: any) => ({ disabled: r.id === user?.id }),
            }}
            dataSource={query.data?.items || []}
            pagination={{
              current: page,
              total: query.data?.total,
              pageSize: 15,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (n) => `共 ${n} 条`,
            }}
            columns={[
              {
                title: '用户',
                dataIndex: 'name',
                render: (v, r: any) => (
                  <div>
                    <strong className="table-title" onClick={() => open(r)}>
                      {v}
                    </strong>
                    <div className="table-secondary">{r.username}</div>
                  </div>
                ),
              },
              {
                title: '角色',
                dataIndex: 'roles',
                render: (v: any) => (
                  <Space size={3} wrap>
                    {v?.map((x: any) => {
                      const r = typeof x === 'string' ? x : x.role?.name || x.name;
                      return <Tag key={r}>{label(r)}</Tag>;
                    })}
                  </Space>
                ),
              },
              { title: '学号 / 工号', dataIndex: 'studentNo', render: (v) => v || '—' },
              {
                title: '专业',
                dataIndex: 'majorId',
                render: (value) =>
                  majors.data?.items.find((item) => item.id === value)?.name ||
                  (value ? '已设置专业' : '未指定'),
              },
              {
                title: '状态',
                render: (_, r: any) => (
                  <Status value={r.status || (r.active === false ? 'DISABLED' : 'ACTIVE')} />
                ),
              },
              { title: '创建时间', dataIndex: 'createdAt', render: (v) => date(v) },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Space size={0}>
                    <Button type="link" onClick={() => open(r)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title={`确定${r.active === false ? '启用' : '停用'}该账号？`}
                      onConfirm={() =>
                        action.mutateAsync({
                          path: `/admin/users/${r.id}`,
                          method: 'PATCH',
                          body: { active: r.active === false },
                        })
                      }
                    >
                      <Button type="link" danger={r.status !== 'DISABLED'} disabled={r.id === user?.id}>
                        {r.active === false ? '启用' : '停用'}
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </QueryState>
      </Panel>
      <Modal
        title={modal?.id ? '编辑用户' : '新增用户'}
        open={!!modal}
        onCancel={() => setModal(null)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input disabled={!!modal?.id} />
          </Form.Item>
          <Form.Item name="studentNo" label="学号 / 工号">
            <Input />
          </Form.Item>
          <Form.Item
            name="majorId"
            label="学生专业"
            extra="组织学生的专业由管理员指定；可在“专业与成员申请”中维护目录。"
            getValueFromEvent={(value) => value ?? null}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择专业（可选）"
              options={majors.data?.items
                .filter((item) => item.active || item.id === modal?.majorId)
                .map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          {modal?.id ? (
            <Alert
              type="info"
              showIcon
              message="账号密码由本人设置"
              description="本人须已在个人中心预留恢复码。发起恢复后全部会话和敏感授权会撤销，须在 15 分钟内由本人前往登录页完成。"
              action={
                <Popconfirm title="发起账号恢复并撤销当前会话及敏感授权？" onConfirm={recoverAccount}>
                  <Button loading={recoveryBusy}>发起恢复</Button>
                </Popconfirm>
              }
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Form.Item
              name="password"
              label="初始密码"
              rules={[
                { required: true, message: '请输入初始密码' },
                { min: 12, message: '至少 12 个字符' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item name="roles" label="角色" rules={[{ required: true, message: '至少选择一个角色' }]}>
            <Select mode="multiple" options={roles.map((value) => ({ value, label: label(value) }))} />
          </Form.Item>
          <p className="form-hint">只能在你获授的范围内分配角色，不能提高自身权限。</p>
        </Form>
      </Modal>
      <Modal
        title="批量导入用户"
        open={importOpen}
        width={760}
        onCancel={() => setImportOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button loading={importBusy} onClick={() => importData()}>
              校验并预览
            </Button>
            <Button
              type="primary"
              loading={importBusy}
              disabled={!preview?.valid || preview.errors?.length > 0}
              onClick={() => importData(true)}
            >
              确认导入
            </Button>
          </Space>
        }
      >
        <Alert
          showIcon
          type="info"
          message="先校验，再提交。每行包含 username、name、password、role、studentNo；可选 majorId 指定学生专业，留空则暂不指定。"
          style={{ marginBottom: 16 }}
        />
        <Space style={{ marginBottom: 15 }}>
          <Button href="/api/admin/users/template">下载 CSV 模板</Button>
          <Upload
            accept=".csv"
            showUploadList={false}
            beforeUpload={async (file) => {
              setCsv(await file.text());
              setPreview(undefined);
              return false;
            }}
          >
            <Button icon={<UploadIcon size={14} />}>选择 CSV 文件</Button>
          </Upload>
          {preview?.errors?.length > 0 && (
            <Button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(preview.errors, null, 2)], { type: 'application/json' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'import-errors.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              下载错误结果
            </Button>
          )}
        </Space>
        <Input.TextArea
          rows={7}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder={
            'username,name,password,role,studentNo,majorId\nstudent001,张同学,安全的初始密码,STUDENT,2026001,'
          }
        />
        {preview && (
          <>
            <p className="form-hint" style={{ marginTop: 16 }}>
              有效 {preview.preview?.length ?? 0} 行 · 错误 {preview.errors?.length ?? 0} 行
            </p>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              dataSource={preview.errors?.length ? preview.errors : preview.preview || []}
              columns={
                preview.errors?.length
                  ? [
                      { title: '行号', dataIndex: 'row' },
                      { title: '错误原因', dataIndex: 'message' },
                    ]
                  : [
                      { title: '账号', dataIndex: 'username' },
                      { title: '姓名', dataIndex: 'name' },
                      { title: '角色', dataIndex: 'role', render: label },
                    ]
              }
              pagination={{ pageSize: 5 }}
            />
          </>
        )}
      </Modal>
    </>
  );
}
export function Organization() {
  const { user } = useAuth();
  const [tab, setTab] = useState('classes');
  const [page, setPage] = useState(1);
  const query = useData(`/admin/${tab}?page=${page}&pageSize=15`);
  const terms = useData('/admin/terms');
  const catalog = useData('/catalog');
  const action = useAction();
  const [modal, setModal] = useState<any>(null);
  const [members, setMembers] = useState<any>(null);
  const [memberPage, setMemberPage] = useState(1);
  const memberQuery = useData(
    `/admin/classes/${members?.id}/members?page=${memberPage}&pageSize=8`,
    !!members,
  );
  const [form] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [assignClass, setAssignClass] = useState<any>();
  const [assignCourse, setAssignCourse] = useState<string>();
  const [transfer, setTransfer] = useState<any>();
  const [transferTo, setTransferTo] = useState<string>();
  const [orgAdmin, setOrgAdmin] = useState<any>();
  const [orgForm] = Form.useForm();
  function open(record: any = {}) {
    setModal(record);
    form.resetFields();
    form.setFieldsValue(record);
  }
  const columns: any[] =
    tab === 'classes'
      ? [
          { title: '班级名称', dataIndex: 'name' },
          { title: '年级 / 部门', dataIndex: 'grade' },
          {
            title: '学期',
            render: (_: any, r: any) =>
              r.term?.name || terms.data?.items?.find((t: any) => t.id === r.termId)?.name || '—',
          },
          { title: '学生人数', render: (_: any, r: any) => r._count?.members ?? r.memberCount ?? '—' },
          {
            title: '操作',
            render: (_: any, r: any) => (
              <Space>
                <Button type="link" onClick={() => open(r)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  onClick={() => {
                    setMembers(r);
                    setMemberPage(1);
                  }}
                >
                  班级成员
                </Button>
                <Button
                  type="link"
                  onClick={() => {
                    setAssignClass(r);
                    setAssignCourse(undefined);
                  }}
                >
                  分配课程
                </Button>
              </Space>
            ),
          },
        ]
      : tab === 'terms'
        ? [
            { title: '学期名称', dataIndex: 'name' },
            { title: '开始日期', dataIndex: 'startsAt', render: (v: string) => date(v, true) },
            { title: '结束日期', dataIndex: 'endsAt', render: (v: string) => date(v, true) },
          ]
        : [
            { title: '机构名称', dataIndex: 'name' },
            { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => date(v) },
            {
              title: '操作',
              render: (_: any, r: any) => (
                <Space>
                  <Button type="link" onClick={() => open(r)}>
                    编辑机构
                  </Button>
                  <Button
                    type="link"
                    onClick={() => {
                      setOrgAdmin(r);
                      orgForm.resetFields();
                    }}
                  >
                    建立机构管理员
                  </Button>
                </Space>
              ),
            },
          ];
  return (
    <>
      <PageTitle
        eyebrow="ORGANIZATION"
        title="组织与教学"
        description="行政班级与课程教学关系分开管理，成员变更保留历史记录。"
        extra={
          <Button type="primary" icon={<Plus size={16} />} onClick={() => open()}>
            新增{tab === 'classes' ? '班级' : tab === 'terms' ? '学期' : '机构'}
          </Button>
        }
      />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
          }}
          items={[
            { key: 'classes', label: '行政班级' },
            { key: 'terms', label: '学期管理' },
            ...(user?.role === 'SUPER_ADMIN' ? [{ key: 'organizations', label: '机构管理' }] : []),
          ]}
        />
        <QueryState query={query}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={query.data?.items || []}
            pagination={{
              current: page,
              pageSize: 15,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <Modal
        title={`维护${tab === 'classes' ? '班级' : tab === 'terms' ? '学期' : '机构'}`}
        open={!!modal}
        onCancel={() => setModal(null)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: `/admin/${tab}${modal.id ? `/${modal.id}` : ''}`,
              method: modal.id ? 'PATCH' : 'POST',
              body:
                tab === 'terms'
                  ? {
                      ...values,
                      startsAt: new Date(values.startsAt + 'T00:00:00+08:00').toISOString(),
                      endsAt: new Date(values.endsAt + 'T23:59:59+08:00').toISOString(),
                    }
                  : values,
            });
            setModal(null);
          }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          {tab === 'classes' ? (
            <>
              <Form.Item
                name="grade"
                label="年级 / 部门"
                rules={[{ required: true, message: '请输入年级或部门' }]}
              >
                <AutoComplete
                  options={(catalog.data?.grades || []).map((value: string) => ({ value }))}
                  placeholder="选择或输入年级 / 部门"
                />
              </Form.Item>
              <Form.Item name="termId" label="所属学期">
                <RemoteSelect endpoint="/admin/terms" />
              </Form.Item>
            </>
          ) : tab === 'terms' ? (
            <>
              <Form.Item name="startsAt" label="开始日期" rules={[{ required: true, message: '请选择日期' }]}>
                <Input type="date" />
              </Form.Item>
              <Form.Item name="endsAt" label="结束日期" rules={[{ required: true, message: '请选择日期' }]}>
                <Input type="date" />
              </Form.Item>
            </>
          ) : (
            <>
              {modal?.id && (
                <>
                  <Form.Item name="active" label="机构启用" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="reason"
                    label="变更原因"
                    rules={[{ required: true, min: 5, message: '请填写至少 5 字的原因' }]}
                  >
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </>
              )}
            </>
          )}
        </Form>
      </Modal>
      <Modal
        title={`${members?.name || ''} · 班级成员`}
        open={!!members}
        onCancel={() => setMembers(null)}
        width={720}
        footer={null}
      >
        <Form
          form={memberForm}
          layout="inline"
          onFinish={async (values) => {
            await action.mutateAsync({ path: `/admin/classes/${members.id}/members`, body: values });
            memberForm.resetFields();
          }}
          style={{ marginBottom: 20 }}
        >
          <Form.Item name="userId" rules={[{ required: true, message: '请选择学生' }]}>
            <RemoteSelect
              endpoint="/admin/people"
              params={{ role: 'STUDENT' }}
              placeholder="选择学生加入班级"
              style={{ width: 270 }}
              labelFor={(record) => `${record.name}（${record.username}）`}
            />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={action.isPending}>
            加入班级
          </Button>
        </Form>
        <QueryState query={memberQuery}>
          <Table
            rowKey="id"
            dataSource={memberQuery.data?.items || []}
            columns={[
              { title: '姓名', render: (_, r: any) => r.user?.name || r.name },
              { title: '账号', render: (_, r: any) => r.user?.username || r.username },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Space>
                    <Button
                      type="link"
                      onClick={() => {
                        setTransfer(r);
                        setTransferTo(undefined);
                      }}
                    >
                      转班
                    </Button>
                    <Popconfirm
                      title="移除此班级成员？历史数据将保留。"
                      onConfirm={() =>
                        action.mutateAsync({
                          path: `/admin/classes/${members.id}/members`,
                          body: { userId: r.userId || r.id, active: false },
                        })
                      }
                    >
                      <Button type="link" danger>
                        移除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            pagination={{
              current: memberPage,
              pageSize: 8,
              total: memberQuery.data?.total,
              onChange: setMemberPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Modal>
      <Modal
        title="分配课程教学班"
        open={!!assignClass}
        onCancel={() => setAssignClass(undefined)}
        onOk={async () => {
          await action.mutateAsync({
            path: `/admin/classes/${assignClass.id}/courses`,
            body: { courseId: assignCourse },
          });
          setAssignClass(undefined);
        }}
        okButtonProps={{ disabled: !assignCourse }}
      >
        <p className="form-hint">为 {assignClass?.name} 建立课程教学班，当前班级学生会加入此课程。</p>
        <RemoteSelect
          endpoint="/courses"
          labelField="title"
          value={assignCourse}
          onChange={setAssignCourse}
        />
      </Modal>
      <Modal
        title="学生转班"
        open={!!transfer}
        onCancel={() => setTransfer(undefined)}
        onOk={async () => {
          await action.mutateAsync({
            path: `/admin/classes/${transferTo}/members`,
            body: { userId: transfer.id, transferFrom: members.id },
          });
          setTransfer(undefined);
        }}
        okButtonProps={{ disabled: !transferTo }}
      >
        <p className="form-hint">
          {transfer?.name} 将移出 {members?.name}，历史作业与成绩记录保留。
        </p>
        <RemoteSelect
          endpoint="/admin/classes"
          placeholder="选择目标班级"
          value={transferTo}
          onChange={setTransferTo}
          excludeIds={[members?.id]}
        />
      </Modal>
      <Modal
        title={`建立机构管理员 · ${orgAdmin?.name || ''}`}
        open={!!orgAdmin}
        onCancel={() => setOrgAdmin(undefined)}
        onOk={() => orgForm.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={orgForm}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({ path: `/admin/organizations/${orgAdmin.id}/admins`, body: values });
            setOrgAdmin(undefined);
          }}
        >
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, min: 12, message: '请使用至少 12 位的安全密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="建立原因"
            rules={[{ required: true, min: 5, message: '请填写至少 5 字的原因' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function Audit() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(params.get('tab') === 'jobs' ? 'jobs' : 'audit');
  const [page, setPage] = useState(1);
  const query = useData(`/admin/${tab}?${queryString({ action: search, page, pageSize: 20 })}`);
  return (
    <>
      <PageTitle
        eyebrow="AUDIT & OPERATIONS"
        title="审计与运行记录"
        description="记录关键业务、授权与安全操作。敏感凭据不会写入业务日志。"
      />
      <div className="filter-bar">
        <Input.Search
          placeholder="搜索操作或资源"
          allowClear
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          style={{ maxWidth: 350 }}
        />
      </div>
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
          }}
          items={[
            { key: 'audit', label: '操作审计' },
            { key: 'jobs', label: '后台任务' },
          ]}
        />
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            expandable={{
              expandedRowRender: (record: any) => (
                <pre className="audit-detail">
                  {JSON.stringify(record.details || record.metadata || {}, null, 2)}
                </pre>
              ),
            }}
            columns={
              tab === 'jobs'
                ? [
                    { title: '任务类型', dataIndex: 'kind' },
                    { title: '状态', dataIndex: 'status', render: (v) => <Status value={v} /> },
                    { title: '尝试次数', dataIndex: 'attempts' },
                    { title: '计划运行时间', dataIndex: 'runAt', render: (v) => date(v) },
                    { title: '最近错误', dataIndex: 'lastError', render: (v) => v || '—' },
                  ]
                : [
                    { title: '时间', dataIndex: 'createdAt', render: (v) => date(v), width: 135 },
                    {
                      title: '操作人',
                      render: (_, r: any) => r.actor?.name || r.actorName || r.userId || '系统任务',
                    },
                    { title: '操作', dataIndex: 'action', render: (v) => <Tag>{v}</Tag> },
                    { title: '资源类型', dataIndex: 'resourceType' },
                    { title: '资源标识', dataIndex: 'resourceId', ellipsis: true },
                    { title: '追踪 ID', dataIndex: 'requestId', ellipsis: true },
                  ]
            }
            pagination={{
              current: page,
              pageSize: 20,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
    </>
  );
}
export function SystemSettings() {
  const query = useData('/admin/settings');
  const { user } = useAuth();
  const platform = user?.permissions.includes('settings.platform');
  const action = useAction('系统设置已保存');
  const [edit, setEdit] = useState<any>();
  const [form] = Form.useForm();
  const settings = query.data?.items || [];
  const definitions = [
    { key: 'platformName', name: '平台名称', type: 'text' },
    { key: 'logoUrl', name: '平台 Logo 地址', type: 'text' },
    { key: 'notificationEnabled', name: '站内通知', type: 'boolean' },
    { key: 'dataDictionary', name: '课程分类与年级字典', type: 'dictionary' },
    ...(platform
      ? [
          { key: 'maxUploadMB', name: '最大上传文件（MB）', type: 'number' },
          { key: 'allowedFileTypes', name: '允许上传的文件类型', type: 'types' },
          { key: 'loginPolicy', name: '登录会话策略', type: 'session' },
          { key: 'features', name: '平台功能开关', type: 'features' },
        ]
      : []),
  ];
  return (
    <>
      <PageTitle
        eyebrow="SYSTEM SETTINGS"
        title="系统配置"
        description="配置修改需要填写原因，保存后写入审计记录。"
      />
      <Panel title="平台与运行参数">
        <QueryState query={query}>
          <Table
            rowKey="key"
            dataSource={definitions}
            pagination={false}
            columns={[
              { title: '配置项', dataIndex: 'name' },
              {
                title: '当前配置',
                render: (_, r: any) => {
                  const value = settings.find((s: any) => s.key === r.key)?.value;
                  return value === undefined
                    ? '使用系统默认值'
                    : typeof value === 'boolean'
                      ? value
                        ? '已开启'
                        : '已关闭'
                      : Array.isArray(value)
                        ? value.join('、')
                        : r.type === 'session'
                          ? `${value.sessionHours} 小时`
                          : r.type === 'dictionary'
                            ? `课程分类 ${(value.courseCategories || []).length} 项 · 年级 / 部门 ${(value.grades || []).length} 项`
                            : r.type === 'features'
                              ? `练习 ${value.practice ? '开启' : '关闭'} · 交流 ${value.communication ? '开启' : '关闭'}`
                              : String(value);
                },
              },
              {
                title: '操作',
                render: (_, r: any) => (
                  <Button
                    type="link"
                    onClick={() => {
                      setEdit(r);
                      form.resetFields();
                      form.setFieldsValue({ value: settings.find((s: any) => s.key === r.key)?.value });
                    }}
                  >
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        </QueryState>
      </Panel>
      <Modal
        title={`编辑${edit?.name || '配置'}`}
        open={!!edit}
        onCancel={() => setEdit(undefined)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: '/admin/settings',
              method: 'PATCH',
              body: { key: edit.key, ...values },
            });
            setEdit(undefined);
          }}
        >
          {edit?.type === 'dictionary' ? (
            <>
              <Form.Item
                name={['value', 'courseCategories']}
                label="课程分类"
                initialValue={[]}
                rules={[{ type: 'array', max: 100, message: '最多 100 项' }]}
              >
                <Select
                  mode="tags"
                  maxCount={100}
                  tokenSeparators={['，', ',']}
                  placeholder="输入分类后按回车，可增加或移除"
                />
              </Form.Item>
              <Form.Item
                name={['value', 'grades']}
                label="年级 / 部门"
                initialValue={[]}
                rules={[{ type: 'array', max: 100, message: '最多 100 项' }]}
              >
                <Select
                  mode="tags"
                  maxCount={100}
                  tokenSeparators={['，', ',']}
                  placeholder="输入年级或部门后按回车"
                />
              </Form.Item>
              <p className="form-hint">
                每类最多 100 项。课程和班级编辑时会显示这些可选值，已有教学数据保留。
              </p>
            </>
          ) : edit?.type === 'features' ? (
            <>
              <Form.Item name={['value', 'practice']} label="练习功能" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name={['value', 'communication']} label="交流功能" valuePropName="checked">
                <Switch />
              </Form.Item>
            </>
          ) : edit?.type === 'session' ? (
            <Form.Item
              name={['value', 'sessionHours']}
              label="会话有效时长（小时）"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={72} />
            </Form.Item>
          ) : (
            <Form.Item
              name="value"
              label={edit?.name}
              valuePropName={edit?.type === 'boolean' ? 'checked' : 'value'}
              rules={[{ required: true, message: '请填写配置值' }]}
            >
              {edit?.type === 'boolean' ? (
                <Switch />
              ) : edit?.type === 'number' ? (
                <InputNumber min={1} max={50} />
              ) : edit?.type === 'types' ? (
                <Select
                  mode="multiple"
                  options={[
                    'image/png',
                    'image/jpeg',
                    'application/pdf',
                    'text/plain',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  ].map((value) => ({ value, label: value }))}
                />
              ) : (
                <Input />
              )}
            </Form.Item>
          )}
          <Form.Item
            name="reason"
            label="修改原因"
            rules={[{ required: true, min: 5, message: '请填写至少 5 字的原因' }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function RolePermissions() {
  const query = useData('/admin/roles');
  const { user } = useAuth();
  const action = useAction('角色权限已更新');
  const [edit, setEdit] = useState<any>(null);
  const [permission, setPermission] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const roles = query.data?.items || query.data?.roles || [];
  const available = query.data?.permissions || [];
  return (
    <>
      <PageTitle
        eyebrow="ACCESS CONTROL"
        title="角色与权限"
        description="功能权限结合资源归属校验。敏感能力需要独立授权与审计。"
      />
      <Alert
        type="info"
        showIcon
        message="切换角色不会扩大授权范围。机构管理员不能授予超级管理员身份，也不能提升自身权限。"
        style={{ marginBottom: 23 }}
      />
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={roles}
            columns={[
              { title: '角色', render: (_, r: any) => label(r.id) },
              { title: '说明', dataIndex: 'description' },
              {
                title: '功能权限',
                render: (_, r: any) => (
                  <Space wrap size={3}>
                    {(r.permissions || []).map((p: any) => {
                      const value = typeof p === 'string' ? p : p.permissionId || p.permission?.id || p.id;
                      return <Tag key={value}>{value}</Tag>;
                    })}
                  </Space>
                ),
              },
              ...(user?.role === 'SUPER_ADMIN'
                ? [
                    {
                      title: '操作',
                      render: (_: any, r: any) => (
                        <Button
                          type="link"
                          onClick={() => {
                            setEdit(r);
                            setPermission(
                              (r.permissions || []).map((p: any) =>
                                typeof p === 'string' ? p : p.permissionId || p.permission?.id || p.id,
                              ),
                            );
                          }}
                        >
                          编辑授权
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
            pagination={false}
          />
        </QueryState>
      </Panel>
      {user?.permissions.includes('grants.manage') && <SensitiveGrants />}
      <Modal
        title={`编辑${label(edit?.id || '')}授权`}
        open={!!edit}
        onCancel={() => setEdit(null)}
        onOk={async () => {
          await action.mutateAsync({
            path: `/admin/roles/${edit.id}`,
            method: 'PATCH',
            body: { permissions: permission, reason },
          });
          setEdit(null);
        }}
        confirmLoading={action.isPending}
        okButtonProps={{ disabled: reason.trim().length < 5 }}
      >
        <Input.TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="填写授权变更原因（至少 5 字）"
          style={{ marginBottom: 15 }}
        />
        <Alert
          type="warning"
          showIcon
          message="授权变更影响此角色所有用户，保存后立即生效。"
          style={{ marginBottom: 20 }}
        />
        <Checkbox.Group
          value={permission}
          onChange={(values) => setPermission(values as string[])}
          options={available.map((p: any) => ({
            value: typeof p === 'string' ? p : p.id,
            label: typeof p === 'string' ? p : p.description || p.name || p.id,
          }))}
        />
        {!available.length && (
          <Input.TextArea
            rows={6}
            value={permission.join('\n')}
            onChange={(event) => setPermission(event.target.value.split('\n').filter(Boolean))}
          />
        )}
      </Modal>
    </>
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
function SensitiveGrants() {
  const [page, setPage] = useState(1);
  const query = useData(`/admin/grants?page=${page}&pageSize=10`);
  const people = useData('/admin/people?pageSize=100');
  const permissions = useData('/admin/roles');
  const [open, setOpen] = useState(false);
  const [revoke, setRevoke] = useState<any>();
  const [revokeReason, setRevokeReason] = useState('');
  const [form] = Form.useForm();
  const action = useAction('敏感权限授权已记录');
  return (
    <Panel
      title="独立敏感权限授权"
      description="敏感能力单独授予指定账号，有效期不超过 30 天，不允许自行授权。"
      className="rules-panel"
      extra={
        <Button type="primary" onClick={() => setOpen(true)}>
          新增限时授权
        </Button>
      }
    >
      <QueryState query={query}>
        <Table
          rowKey="id"
          dataSource={query.data?.items || []}
          columns={[
            {
              title: '被授权人',
              render: (_, r: any) =>
                r.user?.name ||
                r.userName ||
                people.data?.items?.find((p: any) => p.id === r.userId)?.name ||
                r.userId,
            },
            { title: '权限', dataIndex: 'permissionId' },
            { title: '截止时间', dataIndex: 'expiresAt', render: (v) => date(v) },
            {
              title: '状态',
              render: (_, r: any) => (
                <Tag color={new Date(r.expiresAt) > new Date() ? 'green' : 'default'}>
                  {new Date(r.expiresAt) > new Date() ? '有效' : '已过期'}
                </Tag>
              ),
            },
            { title: '授权原因', dataIndex: 'reason' },
            {
              title: '操作',
              render: (_, r: any) => (
                <Button
                  type="link"
                  danger
                  disabled={new Date(r.expiresAt) <= new Date()}
                  onClick={() => {
                    setRevoke(r);
                    setRevokeReason('');
                  }}
                >
                  撤销授权
                </Button>
              ),
            },
          ]}
          pagination={{
            current: page,
            pageSize: 10,
            total: query.data?.total,
            onChange: setPage,
            showSizeChanger: false,
          }}
        />
      </QueryState>
      <Modal
        title="新增敏感能力限时授权"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            await action.mutateAsync({
              path: '/admin/grants',
              body: { ...values, expiresAt: new Date(values.expiresAt + '+08:00').toISOString() },
            });
            setOpen(false);
            form.resetFields();
          }}
        >
          <Form.Item name="userId" label="被授权账号" rules={[{ required: true, message: '请选择账号' }]}>
            <RemoteSelect endpoint="/admin/people" placeholder="搜索账号或姓名" />
          </Form.Item>
          <Form.Item name="permissionId" label="敏感权限" rules={[{ required: true, message: '请选择权限' }]}>
            <Select
              options={(permissions.data?.permissions || [])
                .filter((p: any) => p.sensitive)
                .map((p: any) => ({ value: p.id, label: p.description || p.name || p.id }))}
            />
          </Form.Item>
          <Form.Item
            name="expiresAt"
            label="授权截止时间"
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="授权原因"
            rules={[{ required: true, min: 5, message: '至少 5 个字' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="撤销敏感权限授权"
        open={!!revoke}
        onCancel={() => setRevoke(undefined)}
        onOk={async () => {
          await action.mutateAsync({
            path: `/admin/grants/${revoke.id}`,
            method: 'DELETE',
            body: { reason: revokeReason },
          });
          setRevoke(undefined);
        }}
        okButtonProps={{ danger: true, disabled: revokeReason.trim().length < 5 }}
      >
        <p className="form-hint">撤销后，后续接口与导出下载会立即重新校验权限。</p>
        <Input.TextArea
          value={revokeReason}
          onChange={(e) => setRevokeReason(e.target.value)}
          rows={3}
          placeholder="填写撤销原因（至少 5 字）"
        />
      </Modal>
    </Panel>
  );
}
