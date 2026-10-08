import { Checkbox, Form, Input, InputNumber, Radio, Select } from 'antd';
import type { LearningModule } from './types';

export function formValues(module: LearningModule, values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const field = module.fields.find((item) => item.key === key);
      return [
        key,
        (field?.type === 'matrix' || field?.type === 'json') && typeof value !== 'string'
          ? JSON.stringify(value, null, 2)
          : value,
      ];
    }),
  );
}

export function ModuleFields({ module }: { module: LearningModule }) {
  if (module.kind === 'quiz')
    return (
      <div className="academic-questions">
        {module.questions?.map((question, index) => (
          <Form.Item
            key={question.id}
            name={['answers', question.id]}
            label={
              <span>
                {index + 1}. {question.prompt}
              </span>
            }
            rules={[{ required: true, message: '请选择一个答案' }]}
          >
            <Radio.Group className="academic-choices">
              {question.choices.map((choice) => (
                <Radio key={choice.id} value={choice.id}>
                  {choice.label}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
        ))}
      </div>
    );
  return (
    <div className="academic-fields">
      {module.fields.map((field) => (
        <Form.Item
          key={field.key}
          name={field.key}
          label={field.label}
          extra={field.help}
          valuePropName={field.type === 'checkbox' ? 'checked' : 'value'}
          rules={
            field.type === 'checkbox' ? [] : [{ required: field.required, message: `请填写${field.label}` }]
          }
          className={['textarea', 'matrix', 'json'].includes(field.type) ? 'academic-field-wide' : undefined}
        >
          {field.type === 'number' ? (
            <InputNumber
              aria-label={field.label}
              min={field.min}
              max={field.max}
              step={field.step}
              style={{ width: '100%' }}
              placeholder={field.placeholder}
            />
          ) : field.type === 'select' ? (
            <Select
              aria-label={field.label}
              options={field.options}
              placeholder={field.placeholder || '请选择'}
            />
          ) : field.type === 'checkbox' ? (
            <Checkbox>{field.placeholder || field.label}</Checkbox>
          ) : ['textarea', 'matrix', 'json'].includes(field.type) ? (
            <Input.TextArea
              aria-label={field.label}
              rows={field.type === 'textarea' ? 7 : 5}
              maxLength={50000}
              placeholder={field.placeholder}
              spellCheck={false}
              className={field.type !== 'textarea' ? 'academic-code-input' : undefined}
            />
          ) : (
            <Input aria-label={field.label} placeholder={field.placeholder} maxLength={field.max || 1000} />
          )}
        </Form.Item>
      ))}
    </div>
  );
}
