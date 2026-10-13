import { useEffect, useState } from 'react';
import { Form, Input, Button, Typography, message, Alert, Checkbox } from 'antd';
import { LoginOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLES, ROLE_META } from '../lib/constants';
import { isMockMode } from '../lib/cloudbase';

const { Title, Text } = Typography;

// 记住密码（仅本机演示用：账号 + 密码写到 localStorage）
const REMEMBER_KEY = 'party_evaluation_remember';

const readRemember = () => {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
  } catch {
    return null;
  }
};
const writeRemember = (val) => {
  if (!val || !val.remember) localStorage.removeItem(REMEMBER_KEY);
  else localStorage.setItem(REMEMBER_KEY, JSON.stringify(val));
};

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [remember, setRemember] = useState(false);

  // 挂载时回填已记住的账号 / 密码
  useEffect(() => {
    const saved = readRemember();
    if (saved?.username) {
      form.setFieldsValue({ username: saved.username });
      setRemember(true);
      if (saved.remember && saved.password) {
        form.setFieldsValue({ password: saved.password });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFinish = async (values) => {
    setSubmitting(true);
    try {
      const u = await login({
        username: values.username.trim(),
        password: values.password,
      });
      if (!u) {
        message.error('账号或密码错误');
        return;
      }
      // 记住账号（始终）；密码仅在勾选时记住
      writeRemember({
        username: values.username.trim(),
        password: remember ? values.password : '',
        remember,
      });
      message.success(`欢迎，${u.name}（${ROLE_META[u.role]?.text || ''}）`);
      const redirect =
        loc.state?.from || (u.role === ROLES.ADMIN ? '/review' : '/self');
      nav(redirect, { replace: true });
    } catch (e) {
      message.error(e.message || '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36 }}>⭐</div>
          <Title level={3} style={{ margin: '8px 0 0', color: '#b71c1c' }}>
            党员评价系统
          </Title>
          <Text type="secondary">使用注册的账号登录</Text>
        </div>

        {/* 默认账号只存在于「本地调试模式」（数据存在浏览器 localStorage 里）。
            真实模式下账号在 PostgreSQL 的 user_table 表中，需要在库里自行创建。 */}
        {isMockMode() && (
          <Alert
            type="info"
            showIcon
            message="本地调试模式：默认管理员 admin / admin123（数据仅存本机浏览器）"
            style={{ marginBottom: 16, fontSize: 12 }}
          />
        )}

        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            label="账号"
            name="username"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input placeholder="登录账号（6-20 位数字字母）" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="登录密码" autoComplete="current-password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Checkbox
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            >
              记住密码
            </Checkbox>
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            block
            size="large"
            icon={<LoginOutlined />}
          >
            登录
          </Button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Text type="secondary">还没有账号？</Text>
            <Link to="/register" style={{ marginLeft: 6 }}>
              立即注册
            </Link>
          </div>
        </Form>
      </div>
    </div>
  );
}