import { useState } from 'react';
import { Alert, Button, Form, Input, Segmented } from 'antd';
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
  const [recovering, setRecovering] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState('');
  if (user) return <Navigate to="/" replace />;
  async function login(values: any) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (recovering) {
        await send('/auth/recover', {
          username: values.username,
          code: values.code?.trim(),
          newPassword: values.newPassword,
        });
        setRecovering(false);
        form.resetFields(['code', 'newPassword', 'confirm', 'password']);
        setNotice('密码已恢复，请用新密码登录，并在个人中心重新生成恢复码。');
        return;
      }
      const result = registering
        ? await send('/auth/register', {
            username: values.username,
            password: values.password,
            name: values.name,
          })
        : await send('/auth/login', { username: values.username, password: values.password });
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
              <h2 id="signin-title">
                {recovering ? '恢复你的账号' : registering ? '开启你的自主学习空间' : '登录你的账号'}
              </h2>
              <p>
                {recovering
                  ? '个人账号可直接使用本人预留的恢复码；组织账号需先由管理员开启恢复许可。'
                  : registering
                    ? '无需加入组织，注册后自由选择专业与学习模块。'
                    : '继续今天的学习与教学。'}
              </p>
            </div>
            {!recovering && (
              <Segmented
                block
                aria-label="登录或注册"
                value={registering ? 'register' : 'login'}
                options={[
                  { value: 'login', label: '账号登录' },
                  { value: 'register', label: '个人注册' },
                ]}
                disabled={busy}
                style={{ marginBottom: 24 }}
                onChange={(value) => {
                  setRegistering(value === 'register');
                  setError('');
                  setNotice('');
                  form.resetFields(['password', 'confirm', 'name']);
                }}
              />
            )}
            {error && <Alert className="signin-error" type="error" showIcon message={error} />}
            {notice && <Alert className="signin-error" type="success" showIcon message={notice} />}
            <Form
              form={form}
              layout="vertical"
              onFinish={login}
              size="large"
              requiredMark={false}
              disabled={busy}
            >
              {registering && !recovering && (
                <Form.Item
                  name="name"
                  label="姓名或昵称"
                  rules={[{ required: true, message: '请输入姓名或昵称' }, { max: 60 }]}
                >
                  <Input autoComplete="name" maxLength={60} placeholder="你希望我们如何称呼你" />
                </Form.Item>
              )}
              <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
                <Input
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={registering ? '设置你的登录账号' : '个人账号或机构分配的账号'}
                />
              </Form.Item>
              {recovering ? (
                <>
                  <Form.Item
                    name="code"
                    label="本人预留的恢复码"
                    rules={[{ required: true, message: '请输入恢复码' }]}
                  >
                    <Input.Password autoComplete="off" placeholder="lmsr_ 开头的恢复码" />
                  </Form.Item>
                  <Form.Item
                    name="newPassword"
                    label="新密码"
                    rules={[{ required: true }, { min: 12, max: 128, message: '密码须为 12 至 128 个字符' }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item
                    name="confirm"
                    label="确认新密码"
                    dependencies={['newPassword']}
                    rules={[
                      { required: true },
                      ({ getFieldValue }) => ({
                        validator: (_, value) =>
                          !value || value === getFieldValue('newPassword')
                            ? Promise.resolve()
                            : Promise.reject(new Error('两次输入的密码不一致')),
                      }),
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[
                      { required: true, message: '请输入密码' },
                      ...(registering ? [{ min: 12, max: 128, message: '密码须为 12 至 128 个字符' }] : []),
                    ]}
                  >
                    <Input.Password
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      placeholder={registering ? '至少 12 个字符' : '请输入密码'}
                    />
                  </Form.Item>
                  {registering && (
                    <Form.Item
                      name="confirm"
                      label="确认密码"
                      dependencies={['password']}
                      rules={[
                        { required: true, message: '请再次输入密码' },
                        ({ getFieldValue }) => ({
                          validator: (_, value) =>
                            !value || value === getFieldValue('password')
                              ? Promise.resolve()
                              : Promise.reject(new Error('两次输入的密码不一致')),
                        }),
                      ]}
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                  )}
                </>
              )}
              <Button
                type="primary"
                htmlType="submit"
                loading={busy}
                block
                icon={<ArrowRight size={16} />}
                iconPosition="end"
              >
                {recovering ? '使用恢复码设置新密码' : registering ? '注册并开始学习' : '登录学习平台'}
              </Button>
            </Form>
            <p className="signin-help">
              {registering
                ? '个人账号可使用学习工具；之后也可通过邀请码申请加入组织。'
                : '忘记密码时可使用本人预留的恢复码。'}
            </p>
            <Button
              type="link"
              block
              disabled={busy}
              onClick={() => {
                setRecovering(!recovering);
                setRegistering(false);
                setError('');
                setNotice('');
                form.resetFields(['password', 'code', 'newPassword', 'confirm']);
              }}
            >
              {recovering ? '返回账号登录' : '使用预留恢复码恢复账号'}
            </Button>
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
