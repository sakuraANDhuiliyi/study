import { useState } from 'react';
import { App, Button, Input, Space, Tabs, Upload } from 'antd';
import { api } from '../api';
import { RichContent } from './shared';

export function RichTextEditor({
  value = '',
  onChange,
  courseId,
  allowPrivateImages = false,
}: {
  value?: string;
  onChange?: (value: string) => void;
  courseId?: string;
  allowPrivateImages?: boolean;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const { message } = App.useApp();
  const append = (text: string) => onChange?.(value + (value ? '\n' : '') + text);
  return (
    <div>
      <Space wrap style={{ marginBottom: 10 }}>
        <Button size="small" onClick={() => append('<h2>标题</h2>')}>
          标题
        </Button>
        <Button size="small" onClick={() => append('<p>段落文字</p>')}>
          段落
        </Button>
        <Button size="small" onClick={() => append('<strong>重点文字</strong>')}>
          加粗
        </Button>
        <Button size="small" onClick={() => append('<ul><li>列表项目</li></ul>')}>
          列表
        </Button>
        {allowPrivateImages && courseId && (
          <Upload
            accept="image/png,image/jpeg"
            showUploadList={false}
            customRequest={async (options) => {
              try {
                const data = new FormData();
                data.append('file', options.file as Blob);
                data.append('courseId', courseId);
                const file = await api('/attachments', { method: 'POST', body: data });
                append(`<p><img src="/api/attachments/${file.id}/preview" alt="教学图片" /></p>`);
                options.onSuccess?.(file);
                message.success('图片已插入，保存课时后按开放时间展示');
              } catch (error) {
                options.onError?.(error as Error);
                message.error((error as Error).message);
              }
            }}
          >
            <Button size="small">上传图片</Button>
          </Upload>
        )}
      </Space>
      <Space.Compact style={{ width: '100%', marginBottom: 10 }}>
        <Input
          aria-label="图片地址"
          placeholder="https://… 图片地址"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <Button
          onClick={() => {
            if (!/^https:\/\/[^\s<>"']+$/i.test(imageUrl)) {
              message.error('请输入有效的 HTTPS 图片地址');
              return;
            }
            append(`<p><img src="${imageUrl.replaceAll('&', '&amp;')}" alt="教学图片" /></p>`);
            setImageUrl('');
          }}
        >
          插入图片
        </Button>
      </Space.Compact>
      <Tabs
        size="small"
        items={[
          {
            key: 'edit',
            label: '编辑图文',
            children: (
              <Input.TextArea
                aria-label="图文内容编辑器"
                rows={7}
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder="可直接输入文字，或使用上方按钮插入段落、重点、列表和图片。"
              />
            ),
          },
          {
            key: 'preview',
            label: '预览',
            children: (
              <div style={{ minHeight: 150, padding: 12, border: '1px solid #e6eaf0', borderRadius: 8 }}>
                <RichContent content={value || '输入内容后可在此预览'} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
