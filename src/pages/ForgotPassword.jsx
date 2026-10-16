import { useState } from 'react';
import { Form, Input, Button, Typography, message, Card } from 'antd';
import { KeyOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { recoverLookup, recoverReset } from '../lib/userService';

const { Title, Text } = Typography;

// ============================================================
// 忘记密码（两步式自助找回）
// ------------------------------------------------------------
//   第一步：姓名 + 工作证编号 → 核对身份
//   第二步：只有「新密码 + 确认新密码」两个框 → 覆盖 user_table 里原记录的口令
//          （**故意不出现账号输入框**：登录名在这一步既不改也不回显，只能改密码）
//
// ⚠️ 本流程不校验任何身份凭据，只要求姓名与工号能对上。
//    工作证编号是可枚举的（W-0001 ~ W-0048），姓名在单位内部也基本公开，
//    因此它实际上等同于「知道谁的名字和工号，就能重置谁的口令」。
//    这是按需求刻意做成自助式的，风险与可选收紧方案见 server/server.js
//    里 /api/recover/* 上方的说明。
// ============================================================
export default function ForgotPassword() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [identity, setIdentity] = useState({ name: '', workId: '' });
  const [form1] = Form.useForm();
  const [form2] = Form.useForm();

  // 第一步：核对「姓名 + 工作证编号」（接口回不带回账号，前端也不需要它）
  const onVerify = async (values) => {
    setLoading(true);
    try {
      const res = await recoverLookup({
        name: values.name.trim(),
        workId: values.workId.trim(),
      });
      if (res?.code !== 'OK') {
        message.error(res?.message || '姓名或工作证编号不正确');
        return;
      }
      setIdentity({ name: values.name.trim(), workId: values.workId.trim() });
      setStep(2);
    } catch (e) {
      message.error(e.message || '网络异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 第二步：只提交新密码（登录账号不变，后端也忽略任何传上去的账号）
  const onReset = async (values) => {
    setLoading(true);
    try {
      const res = await recoverReset({
        name: identity.name,
        workId: identity.workId,
        password: values.password,
      });
      if (res?.code !== 'OK') {
        message.error(res?.message || '修改失败，请稍后重试');
        return;
      }
      message.success('密码已更新，请用原账号和新密码登录');
      nav('/login', { replace: true });
    } catch (e) {
      message.error(e.message || '网络异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <Card className="login-card" bordered={false}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 36 }}>🔑</div>
          <Title level={3} style={{ margin: '8px 0 0', color: '#b71c1c' }}>
            忘记密码
          </Title>
          <Text type="secondary">
            {step === 1
              ? '先用姓名和工作证编号核对身份'
              : '为刚才核对的那个账号设置新密码（登录账号不变）'}
          </Text>
        </div>

        {step === 1 ? (
          <Form form={form1} layout="vertical" onFinish={onVerify} requiredMark>
            <Form.Item
              label="姓名"
              name="name"
              rules={[{ required: true, message: '请输入姓名' }]}
            >
              <Input placeholder="例如：张三" />
            </Form.Item>

            <Form.Item
              label="工作证编号"
              name="workId"
              rules={[{ required: true, message: '请输入工作证编号' }]}
            >
              <Input placeholder="例如：W-0007" maxLength={32} />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
            >
              下一步
            </Button>
          </Form>
        ) : (
          <Form form={form2} layout="vertical" onFinish={onReset} requiredMark>
            {/* 这一步只保留两个密码框：账号输入框整个不出现（不是灰掉，是没有）——
                登录名改不了，也不回显。后端 /api/recover/reset 同样只更新 pw，
                即使有人手工构造请求带上 user_id 也会被忽略。 */}
            <Form.Item
              label="新密码"
              name="password"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码至少 6 位' },
                { max: 30, message: '密码最多 30 位' },
              ]}
              hasFeedback
            >
              <Input.Password placeholder="6-30 位" maxLength={30} />
            </Form.Item>

            <Form.Item
              label="确认新密码"
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
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
              <Input.Password placeholder="再次输入新密码" maxLength={30} />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
              icon={<KeyOutlined />}
            >
              提交
            </Button>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Button
                type="link"
                onClick={() => setStep(1)}
                icon={<ArrowLeftOutlined />}
                style={{ padding: 0 }}
              >
                返回上一步
              </Button>
            </div>
          </Form>
        )}

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Text type="secondary">想起来了？</Text>
          <Link to="/login" style={{ marginLeft: 6 }}>
            直接登录
          </Link>
        </div>
      </Card>
    </div>
  );
}
