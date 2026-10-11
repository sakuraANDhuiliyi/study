import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Table } from 'antd';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { date, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { PageTitle, Panel, QueryState, Status } from '../../components/shared';
import { money } from './shared';

export function Appeals() {
  const { user } = useAuth();
  const teacher = user?.permissions.includes('assessment.grade');
  const [page, setPage] = useState(1);
  const query = useData(`/appeals?pageSize=12&page=${page}`);
  const action = useAction('复核处理已保存');
  const [record, setRecord] = useState<any>();
  const [form] = Form.useForm();
  return (
    <>
      <PageTitle
        eyebrow="GRADE REVIEW"
        title="成绩复核"
        description={
          teacher
            ? '回应评分疑问，按审批流程记录处理意见与成绩变更。'
            : '查看本人提交的复核申请、处理意见与当前有效成绩。'
        }
      />
      <Panel>
        <QueryState query={query}>
          <Table
            rowKey="id"
            dataSource={query.data?.items || []}
            columns={[
              { title: '申请时间', dataIndex: 'createdAt', render: (v) => date(v) },
              { title: '申请学生', render: (_, r: any) => r.user?.name || r.userId },
              {
                title: '考试',
                render: (_, r: any) => r.exam?.title || r.attempt?.exam?.title || r.attemptId,
              },
              { title: '复核理由', dataIndex: 'reason' },
              { title: '状态', dataIndex: 'status', render: (v) => <Status value={v} /> },
              { title: '处理意见', dataIndex: 'resolution', render: (v) => v || '—' },
              { title: '当前成绩', render: (_, r: any) => money(r.attempt?.scoreCents) },
              {
                title: '操作',
                render: (_, r: any) =>
                  teacher ? (
                    <Button
                      type="link"
                      disabled={r.status === 'resolved'}
                      onClick={() => {
                        setRecord(r);
                        form.resetFields();
                      }}
                    >
                      处理复核
                    </Button>
                  ) : (
                    <Link to={`/exam-attempts/${r.attemptId}`}>查看本人答卷</Link>
                  ),
              },
            ]}
            pagination={{
              current: page,
              pageSize: 12,
              total: query.data?.total,
              onChange: setPage,
              showSizeChanger: false,
            }}
          />
        </QueryState>
      </Panel>
      <Modal
        title="处理成绩复核"
        open={!!record}
        onCancel={() => setRecord(undefined)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Alert type="info" showIcon message={record?.reason} style={{ marginBottom: 20 }} />
        <Link className="inline-link" to={`/grading/exam/${record?.attemptId}`} target="_blank">
          核对原始答卷
          <ArrowRight size={14} />
        </Link>
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 20 }}
          onFinish={async (values) => {
            await action.mutateAsync({
              path: `/appeals/${record.id}/resolve`,
              body: {
                resolution: values.resolution,
                ...(values.score !== undefined && values.score !== null
                  ? { scoreCents: Math.round(values.score * 100) }
                  : {}),
              },
            });
            setRecord(undefined);
          }}
        >
          <Form.Item
            name="resolution"
            label="处理意见及原因"
            rules={[{ required: true, min: 5, message: '至少填写 5 个字的处理意见' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="score" label="修订后总分（留空则保持原成绩）">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <p className="form-hint">
            修改成绩需要独立权限，保存原分、新分、原因和操作者。统计会使用修订后的有效成绩。
          </p>
        </Form>
      </Modal>
    </>
  );
}
