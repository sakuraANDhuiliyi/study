import { useState } from 'react';
import { Alert, Button, Form, Input } from 'antd';
import { BookOpen, ArrowRight, ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { send, useData } from '../api';
import { useAuth } from '../auth';
import '../login.css';
export function Login() {
  const { user, refresh } = useAuth();
  const platform = useData('/platform');
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function login(values: any) {
    setBusy(true);
    setError('');
    try {
      const result = await send('/auth/login', values);
      client.setQueryData(['auth'], result);
      await refresh();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin-screen">
      <div className="signin-container">
        <header className="signin-brand">
          <div className="signin-brand-title">
            <span className="signin-brand-mark" aria-hidden="true">
              <BookOpen size={22} strokeWidth={1.8} />
            </span>
            <h1>{platform.data?.name || '知学'}</h1>
          </div>
          <p>教学与学习，从这里开始</p>
        </header>

        <section className="signin-card" aria-labelledby="signin-title">
          <div className="signin-card-body">
            <div className="signin-heading">
              <h2 id="signin-title">登录你的账号</h2>
              <p>继续今天的学习与教学。</p>
            </div>
            {error && <Alert className="signin-error" type="error" showIcon message={error} />}
            <Form
              form={form}
              layout="vertical"
              onFinish={login}
              size="large"
              requiredMark={false}
              disabled={busy}
            >
              <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
                <Input
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="学校或机构分配的账号"
                />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password autoComplete="current-password" placeholder="请输入密码" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                block
                icon={<ArrowRight size={16} />}
                iconPosition="end"
              >
                登录学习平台
              </Button>
            </Form>
            <p className="signin-help">无法登录？请联系所在机构的管理员。</p>
          </div>

          {import.meta.env.DEV && (
            <div className="signin-development">
              <div className="signin-development-heading">
                <strong>开发环境账号</strong>
                <span>选择身份填入账号</span>
              </div>
              <div className="signin-account-buttons">
                {[
                  { username: 'student', label: '学生' },
                  { username: 'teacher', label: '教师' },
                  { username: 'admin', label: '机构管理员' },
                  { username: 'superadmin', label: '平台管理员' },
                ].map((account) => (
                  <Button
                    key={account.username}
                    size="small"
                    disabled={busy}
                    onClick={() => form.setFieldValue('username', account.username)}
                  >
                    {account.label}
                  </Button>
                ))}
              </div>
              <p>密码使用开发环境种子脚本中的设置。</p>
            </div>
          )}
        </section>

        <div className="signin-role-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>拥有多个身份时，可在登录后切换工作空间。</p>
        </div>
        <footer className="signin-footer">课程学习 · 作业考试 · 交流反馈</footer>
      </div>
    </main>
  );
}
