import { Checkbox, Input, Radio, Select, Tag } from 'antd';
import { label, useData } from '../../api';
import { RemoteSelect } from '../../components/RemoteSelect';
import { RichContent } from '../../components/shared';

const types = ['single', 'multiple', 'boolean', 'blank', 'short', 'composite'];

export const typeOptions = types.map((value) => ({ value, label: label(value) }));

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '—' : Number((cents / 100).toFixed(2));

export const plainText = (value = '') =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

export const qid = (q: any) => q.questionVersionId || q.id;

export const answerArray = (answers: Record<string, any>) =>
  Object.entries(answers)
    .filter(([, value]) => value !== undefined)
    .map(([questionVersionId, value]) => ({ questionVersionId, value }));

export const answerMap = (answers: any[] = []) =>
  Object.fromEntries(answers.map((a) => [a.questionVersionId, a.value]));

export const answered = (value: any) =>
  value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);

export const toISO = (value: string) =>
  value ? new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + '+08:00').toISOString() : undefined;

function AnswerInput({
  question: q,
  value,
  onChange,
  disabled = false,
}: {
  question: any;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
}) {
  if (q.type === 'single')
    return (
      <Radio.Group
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="question-options"
      >
        {q.options?.map((o: any) => (
          <Radio value={o.id} key={o.id}>
            {o.id}.　{o.text}
          </Radio>
        ))}
      </Radio.Group>
    );
  if (q.type === 'multiple')
    return (
      <Checkbox.Group
        disabled={disabled}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        className="question-options"
      >
        {q.options?.map((o: any) => (
          <Checkbox value={o.id} key={o.id}>
            {o.id}.　{o.text}
          </Checkbox>
        ))}
      </Checkbox.Group>
    );
  if (q.type === 'boolean')
    return (
      <Radio.Group
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="question-options"
      >
        <Radio value={true}>正确</Radio>
        <Radio value={false}>错误</Radio>
      </Radio.Group>
    );
  if (q.type === 'composite')
    return (
      <div className="stack">
        {q.children?.map((child: any, index: number) => (
          <div key={child.id}>
            <div className="question-stem">
              <span>（{index + 1}）</span>
              <RichContent content={child.stem} />
              <Tag>{money(child.scoreCents)} 分</Tag>
            </div>
            <AnswerInput
              question={child}
              value={value?.[child.id]}
              onChange={(next) => onChange({ ...value, [child.id]: next })}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
    );
  return (
    <Input.TextArea
      value={typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : ''}
      onChange={(e) => onChange(q.type === 'blank' ? e.target.value.split('\n') : e.target.value)}
      rows={q.type === 'short' ? 5 : 2}
      placeholder={q.type === 'blank' ? '每个填空的答案独占一行' : '请输入你的答案，思路与过程同样重要'}
      disabled={disabled}
    />
  );
}

export function AnswerDisplay({ value }: { value: any }) {
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {value === undefined || value === null
        ? '未作答'
        : typeof value === 'boolean'
          ? value
            ? '正确'
            : '错误'
          : Array.isArray(value)
            ? value.join('、')
            : typeof value === 'object'
              ? Object.entries(value)
                  .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : String(v)}`)
                  .join('\n')
              : String(value)}
    </span>
  );
}

export function QuestionView({
  question: q,
  index,
  value,
  onChange,
  disabled,
  explain,
}: {
  question: any;
  index: number;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  explain?: boolean;
}) {
  return (
    <div className="answer-question">
      <div className="question-meta">
        <Tag bordered={false}>{label(q.type)}</Tag>
        <span>第 {index + 1} 题</span>
        <span>{money(q.scoreCents)} 分</span>
        {q.knowledgePoints?.map((k: string) => (
          <Tag key={k}>{k}</Tag>
        ))}
      </div>
      <div className="question-stem">
        <RichContent content={q.stem} />
      </div>
      <AnswerInput question={q} value={value} onChange={onChange} disabled={disabled} />
      {explain && ('answer' in q || q.explanation) && (
        <div className="question-explanation">
          {'answer' in q && (
            <>
              <strong>参考答案</strong>
              <AnswerDisplay value={q.answer} />
            </>
          )}
          {q.explanation && (
            <>
              <strong style={{ marginTop: 12 }}>答案解析</strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{q.explanation}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function CourseSelect({
  id,
  value,
  onChange,
  allowClear = true,
}: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  allowClear?: boolean;
}) {
  return (
    <RemoteSelect
      id={id}
      endpoint="/courses"
      labelField="title"
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      placeholder="选择课程"
      style={{ minWidth: 210 }}
    />
  );
}

export function ChapterSelect({
  id,
  courseId,
  value,
  onChange,
}: {
  id?: string;
  courseId?: string;
  value?: string;
  onChange?: (id?: string) => void;
}) {
  const course = useData(`/courses/${courseId}`, !!courseId);
  return (
    <Select
      id={id}
      allowClear
      disabled={!courseId}
      value={value}
      onChange={onChange}
      placeholder="全部章节"
      options={(course.data?.chapters || []).map((c: any) => ({ value: c.id, label: c.title }))}
      style={{ minWidth: 180 }}
    />
  );
}
