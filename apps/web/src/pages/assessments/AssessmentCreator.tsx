import { useRef, useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal, Radio, Space, Switch, Table } from 'antd';
import { label, queryString, useAction, useData } from '../../api';
import { RemoteSelect } from '../../components/RemoteSelect';
import { toISO, CourseSelect, money, plainText } from './shared';

export function AssessmentCreator({
  kind,
  open,
  onClose,
}: {
  kind: 'assignments' | 'exams';
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const courseId = Form.useWatch('courseId', form);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionSearch, setQuestionSearch] = useState('');
  const questions = useData(
    `/questions?${queryString({ courseId, search: questionSearch, page: questionPage, pageSize: 10 })}`,
    !!courseId,
  );
  const [questionSource, setQuestionSource] = useState('manual');
  const [paperId, setPaperId] = useState<string>();
  const [paperItems, setPaperItems] = useState<any[]>([]);
  const selectedScores = useRef<Record<string, number>>({});
  for (const q of questions.data?.items || [])
    selectedScores.current[q.versions[0].id] = q.versions[0].scoreCents;
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction('已创建草稿，请检查后发布');
  const exam = kind === 'exams';
  async function create(values: any) {
    const body = {
      ...values,
      questionVersionIds:
        questionSource === 'paper' ? paperItems.map((item) => item.questionVersionId) : selected,
      passCents: Math.round((values.passScore || 0) * 100),
    };
    for (const key of [
      'opensAt',
      'dueAt',
      'startsAt',
      'endsAt',
      'entryClosesAt',
      'scoreReleaseAt',
      'answerReleaseAt',
      'explanationReleaseAt',
      'commentReleaseAt',
      'appealDeadline',
    ])
      if (body[key]) body[key] = toISO(body[key]);
    await action.mutateAsync({ path: `/${kind}`, body });
    onClose();
    form.resetFields();
    setSelected([]);
  }
  return (
    <Modal
      title={exam ? '创建考试草稿' : '创建作业草稿'}
      width={840}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={action.isPending}
      okButtonProps={{ disabled: questionSource === 'paper' ? !paperItems.length : !selected.length }}
      okText="保存草稿"
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={create}
        initialValues={{
          maxAttempts: 1,
          durationMinutes: 60,
          passScore: 0,
          allowBacktrack: true,
          allowLate: false,
          shuffleQuestions: false,
          shuffleOptions: false,
        }}
      >
        <div className="info-list">
          <Form.Item name="courseId" label="所属课程" rules={[{ required: true, message: '请选择课程' }]}>
            <CourseSelect
              allowClear={false}
              onChange={() => {
                setSelected([]);
                setQuestionPage(1);
                setPaperId(undefined);
                setPaperItems([]);
                form.setFieldValue('audienceIds', []);
                form.setFieldValue('graderIds', []);
              }}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label={exam ? '考试名称' : '作业名称'}
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="description" label={exam ? '考试说明与须知' : '作业说明'}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <div className="info-list">
          <Form.Item
            name={exam ? 'startsAt' : 'opensAt'}
            label={exam ? '考试开始时间' : '开放时间'}
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name={exam ? 'endsAt' : 'dueAt'}
            label={exam ? '考试窗口结束时间' : '截止时间'}
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
        </div>
        {exam && (
          <>
            <div className="info-list">
              <Form.Item
                name="entryClosesAt"
                label="最晚允许进入时间"
                rules={[{ required: true, message: '请选择时间' }]}
              >
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="durationMinutes" label="答题时长（分钟）" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="passScore" label="及格分">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="graderIds" label="主观题阅卷教师">
                <RemoteSelect
                  endpoint={`/courses/${courseId}/members`}
                  params={{ kind: 'teacher' }}
                  mode="multiple"
                  disabled={!courseId}
                />
              </Form.Item>
            </div>
            <Space size={25} wrap>
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
                { name: 'scoreReleaseAt', label: '成绩公开时间' },
                { name: 'answerReleaseAt', label: '答案公开时间' },
                { name: 'explanationReleaseAt', label: '解析公开时间' },
                { name: 'commentReleaseAt', label: '教师评语公开时间' },
                { name: 'appealDeadline', label: '成绩复核截止时间' },
              ].map((f) => (
                <Form.Item name={f.name} label={`${f.label}（可选）`} key={f.name}>
                  <Input type="datetime-local" />
                </Form.Item>
              ))}
            </div>
          </>
        )}
        <div className="info-list">
          <Form.Item name="maxAttempts" label="允许提交次数">
            <InputNumber min={1} max={exam ? 10 : 20} style={{ width: '100%' }} />
          </Form.Item>
          {!exam && (
            <Form.Item name="allowLate" label="允许迟交" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </div>
        <Form.Item name="audienceIds" label="指定学生（留空为当前课程全部学生）">
          <RemoteSelect
            endpoint={`/courses/${courseId}/members`}
            params={{ kind: 'student' }}
            mode="multiple"
            disabled={!courseId}
          />
        </Form.Item>
        {exam && (
          <Form.Item label="试卷来源">
            <Radio.Group
              value={questionSource}
              onChange={(e) => setQuestionSource(e.target.value)}
              options={[
                { value: 'manual', label: '手动选题' },
                { value: 'paper', label: '套用已有试卷' },
              ]}
            />
          </Form.Item>
        )}
        {exam && questionSource === 'paper' ? (
          <Form.Item label="已有固定版本试卷" htmlFor="exam-paper-select">
            <RemoteSelect
              id="exam-paper-select"
              endpoint="/papers"
              params={{ courseId }}
              labelField="title"
              disabled={!courseId}
              value={paperId}
              onChange={(value, _option, item) => {
                setPaperId(value);
                setPaperItems(item?.items || []);
              }}
              placeholder="搜索并选择试卷"
            />
            <p className="form-hint">
              已载入 {paperItems.length} 题，总分{' '}
              {money(paperItems.reduce((sum, item) => sum + (item.questionVersion?.scoreCents || 0), 0))}{' '}
              分。考试保存后固定这些题目版本；发布时检查保密限制。
            </p>
          </Form.Item>
        ) : (
          <>
            <Input.Search
              placeholder="搜索待选题目"
              onSearch={(v) => {
                setQuestionSearch(v);
                setQuestionPage(1);
              }}
              style={{ marginBottom: 12 }}
            />
            <div className="list-title-line" style={{ marginBottom: 15 }}>
              <h3 style={{ fontSize: 14 }}>选择题目固定版本</h3>
              <span className="form-hint" style={{ margin: 0 }}>
                已选 {selected.length} 题 · 总分{' '}
                {money(selected.reduce((sum, id) => sum + (selectedScores.current[id] || 0), 0))} 分
              </span>
            </div>
            {exam && (
              <Alert
                type="info"
                showIcon
                message="考试仅可使用从未开放练习、未用于公开作业的保密题。"
                style={{ marginBottom: 15 }}
              />
            )}
            <Table
              rowKey={(r: any) => r.versions[0].id}
              size="small"
              loading={questions.isLoading}
              dataSource={(questions.data?.items || []).filter(
                (q: any) => !exam || (!q.practiceEnabled && !q.everPracticeEnabled),
              )}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
                preserveSelectedRowKeys: true,
              }}
              columns={[
                { title: '题干', render: (_, r: any) => plainText(r.versions[0].stem).slice(0, 90) },
                { title: '题型', render: (_, r: any) => label(r.versions[0].type) },
                { title: '分值', render: (_, r: any) => money(r.versions[0].scoreCents) },
              ]}
              pagination={{
                current: questionPage,
                pageSize: 10,
                total: questions.data?.total,
                onChange: setQuestionPage,
                showSizeChanger: false,
              }}
            />
          </>
        )}
      </Form>
    </Modal>
  );
}
