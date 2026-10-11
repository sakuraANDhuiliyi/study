import { useEffect, useRef } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Space, Switch } from 'antd';
import { useAction } from '../../api';
import { RemoteSelect } from '../../components/RemoteSelect';
import { toISO } from './shared';

export function AssessmentEditor({
  kind,
  data,
  open,
  onClose,
}: {
  kind: 'assignments' | 'exams';
  data: any;
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const action = useAction('设置已保存');
  const editRevision = useRef(data.revision);
  const exam = kind === 'exams';
  const draft = data.status === 'draft';
  const dateKeys = exam
    ? [
        'startsAt',
        'endsAt',
        'entryClosesAt',
        'scoreReleaseAt',
        'answerReleaseAt',
        'explanationReleaseAt',
        'commentReleaseAt',
        'appealDeadline',
      ]
    : ['opensAt', 'dueAt'];
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    editRevision.current = data.revision;
    const values: any = { ...data, passScore: data.passCents / 100 };
    for (const key of dateKeys)
      values[key] = data[key]
        ? new Date(new Date(data[key]).getTime() + 8 * 3600000).toISOString().slice(0, 16)
        : '';
    form.setFieldsValue(values);
  }, [open, data.id]);
  async function save(values: any) {
    const body: any = { ...values, revision: editRevision.current };
    for (const key of dateKeys) if (key in body) body[key] = values[key] ? toISO(values[key]) : null;
    if (exam) {
      body.passCents = Math.round(values.passScore * 100);
      delete body.passScore;
    }
    await action.mutateAsync({ path: `/${kind}/${data.id}`, method: 'PATCH', body });
    onClose();
  }
  return (
    <Modal
      title={exam ? '编辑考试草稿' : '编辑作业'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={action.isPending}
      width={760}
      okText="保存修改"
    >
      <Form form={form} layout="vertical" onFinish={save}>
        {!draft && (
          <Alert
            type="info"
            showIcon
            message="已发布作业可修改名称、说明和延后截止时间。其他规则固定，个别学生补交请使用补交授权。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item
          name="title"
          label={exam ? '考试名称' : '作业名称'}
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label={exam ? '考试说明与须知' : '作业说明'}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <div className="info-list">
          {(exam
            ? [
                { key: 'startsAt', label: '考试开始' },
                { key: 'endsAt', label: '考试结束' },
                { key: 'entryClosesAt', label: '最晚进入' },
              ]
            : [...(draft ? [{ key: 'opensAt', label: '开放时间' }] : []), { key: 'dueAt', label: '截止时间' }]
          ).map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={`${field.label}（北京时间）`}
              rules={[{ required: true, message: '请选择时间' }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          ))}
          {draft && (
            <Form.Item name="maxAttempts" label="允许提交次数">
              <InputNumber min={1} max={exam ? 10 : 20} />
            </Form.Item>
          )}
          {draft && !exam && (
            <Form.Item name="allowLate" label="允许迟交" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          {exam && (
            <>
              <Form.Item name="durationMinutes" label="答题时长（分钟）" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} />
              </Form.Item>
              <Form.Item name="passScore" label="及格分" rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} max={data.totalCents / 100} />
              </Form.Item>
            </>
          )}
        </div>
        {exam && (
          <>
            <Form.Item name="graderIds" label="主观题阅卷教师">
              <RemoteSelect
                endpoint={`/courses/${data.courseId}/members`}
                params={{ kind: 'teacher' }}
                mode="multiple"
              />
            </Form.Item>
            <Space wrap>
              <Form.Item name="shuffleQuestions" label="打乱题目" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="shuffleOptions" label="打乱选项" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="allowBacktrack" label="允许返回上一题" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space>
            <div className="info-list">
              {[
                { key: 'scoreReleaseAt', label: '成绩公开' },
                { key: 'answerReleaseAt', label: '答案公开' },
                { key: 'explanationReleaseAt', label: '解析公开' },
                { key: 'commentReleaseAt', label: '教师评语公开' },
                { key: 'appealDeadline', label: '复核截止' },
              ].map((field) => (
                <Form.Item key={field.key} name={field.key} label={`${field.label}（可选）`}>
                  <Input type="datetime-local" />
                </Form.Item>
              ))}
            </div>
          </>
        )}
        {!draft && (
          <Form.Item
            name="reason"
            label="修改原因"
            rules={[{ required: true, min: 3, message: '请填写至少 3 字原因' }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        )}
        <p className="form-hint">保存使用版本校验，发生并发修改时请刷新后重新检查。</p>
      </Form>
    </Modal>
  );
}
