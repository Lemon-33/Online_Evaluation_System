import { useEffect, useState } from 'react';
import {
  Form,
  Input,
  Button,
  Radio,
  Select,
  message,
  Typography,
  Card,
  Alert,
} from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { useNavigate, Link } from 'react-router-dom';
import {
  ROLES,
  POSITION_TYPES,
  BRANCHES,
  ADMIN_INVITE_CODE,
  getPositionsByType,
} from '../lib/constants';
import { useAuth } from '../context/AuthContext';
import { isMockMode } from '../lib/cloudbase';

const { Title, Text } = Typography;

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const role = Form.useWatch('role', form);
  const positionType = Form.useWatch('positionType', form);
  // 当前岗位类型下的岗位选项
  const positionOptions = getPositionsByType(positionType);

  // 岗位类型变化时清空已选岗位，避免类型与岗位不匹配
  useEffect(() => {
    form.setFieldValue('position', undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionType]);

  const onFinish = async (values) => {
    setSubmitting(true);
    try {
      const u = await register(values);
      message.success(`注册成功，请使用账号 ${u.username} 登录`);
      nav('/login', { replace: true });
    } catch (e) {
      message.error(e.message || '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-bg">
      <Card className="login-card" bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36 }}>📝</div>
          <Title level={3} style={{ margin: '8px 0 0', color: '#b71c1c' }}>
            注册账号
          </Title>
          <Text type="secondary">完成注册后即可登录评价系统</Text>
        </div>

        <Alert
          showIcon
          type="info"
          message={
            isMockMode()
              ? '本地调试模式：默认管理员 admin / admin123；注册「管理员」身份需填写管理员密钥'
              : '注册「管理员」身份需要填写管理员密钥'
          }
          style={{ marginBottom: 16, fontSize: 12 }}
        />

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ role: ROLES.EMPLOYEE }}
          requiredMark
        >
          <Form.Item label="身份" name="role" rules={[{ required: true }]}>
            <Radio.Group buttonStyle="solid">
              <Radio.Button value={ROLES.EMPLOYEE}>员工</Radio.Button>
              <Radio.Button value={ROLES.ADMIN}>管理员</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label="账号"
            name="username"
            rules={[
              { required: true, message: '请输入账号' },
              { min: 6, max: 20, message: '账号长度 6-20 位' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '仅允许字母、数字、下划线' },
            ]}
          >
            <Input placeholder="登录账号（3-20 位字母/数字/下划线）" />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码至少 6 位' },
              { max: 30, message: '密码最多 30 位' },
            ]}
            hasFeedback
          >
            <Input.Password placeholder="6-30 位" maxLength={30} />
          </Form.Item>

          <Form.Item
            label="确认密码"
            name="confirm"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}
            hasFeedback
          >
            <Input.Password placeholder="再次输入密码" />
          </Form.Item>

          <Form.Item
            label="真实姓名"
            name="name"
            rules={[{ required: true, message: '请输入姓名', min: 2 }]}
          >
            <Input placeholder="例如：张三" />
          </Form.Item>

          {/* 员工分支：岗位类型（先选）→ 所在岗位（随类型联动）→ 所在党支部 */}
          {role === ROLES.EMPLOYEE && (
            <>
              <Form.Item
                label="岗位类型"
                name="positionType"
                rules={[{ required: true, message: '请选择岗位类型' }]}
                extra="选择岗位类型后，下方岗位下拉会给出对应可选项"
              >
                <Select
                  placeholder="请选择岗位类型"
                  options={POSITION_TYPES}
                  allowClear
                />
              </Form.Item>
              <Form.Item
                label="所在岗位"
                name="position"
                rules={[{ required: true, message: '请选择所在岗位' }]}
              >
                <Select
                  placeholder={positionType ? '请选择所在岗位' : '请先选择岗位类型'}
                  options={positionOptions}
                  disabled={!positionType}
                  allowClear
                  notFoundContent="请先选择岗位类型"
                />
              </Form.Item>
              <Form.Item
                label="所在党支部"
                name="branch"
                rules={[{ required: true, message: '请选择所在党支部' }]}
              >
                <Select placeholder="请选择所在党支部" options={BRANCHES} />
              </Form.Item>
            </>
          )}

          {/* 管理员分支：所在党支部 + 管理员密钥 */}
          {role === ROLES.ADMIN && (
            <>
              <Form.Item
                label="所在党支部"
                name="branch"
                rules={[{ required: true, message: '请选择所在党支部' }]}
              >
                <Select placeholder="请选择所在党支部" options={BRANCHES} />
              </Form.Item>

              <Form.Item
                label="管理员密钥"
                name="adminCode"
                rules={[
                  { required: true, message: '请输入管理员密钥' },
                  {
                    validator: (_, value) =>
                      value === ADMIN_INVITE_CODE
                        ? Promise.resolve()
                        : Promise.reject(new Error('管理员密钥不正确')),
                  },
                ]}
                extra="注册管理员需要密钥，请向系统管理员获取"
              >
                <Input
                  placeholder="请输入 8 位管理员密钥"
                  maxLength={8}
                  autoComplete="off"
                />
              </Form.Item>
            </>
          )}

          <Button
            type="primary"
            htmlType="submit"
            block
            size="large"
            loading={submitting}
            icon={<UserAddOutlined />}
          >
            立即注册
          </Button>

          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Text type="secondary">已有账号？</Text>
            <Link to="/login" style={{ marginLeft: 6 }}>
              直接登录
            </Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}