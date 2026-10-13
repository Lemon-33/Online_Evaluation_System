import { Card, Descriptions, Tag, Space, Alert } from 'antd';
import { UserOutlined, IdcardOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import {
  ROLES,
  POSITION_TYPES,
  BRANCHES,
  findLabel,
  findPositionLabel,
} from '../lib/constants';

// 个人信息页：注册时确定的资料，只读展示
// 入口：点击顶栏右上角自己的名字
export default function Profile() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Card
        title={
          <Space>
            <IdcardOutlined style={{ color: '#b71c1c' }} />
            <span>个人信息</span>
          </Space>
        }
      >
        <Descriptions column={2} bordered size="middle">
          <Descriptions.Item label="姓名">{user?.name}</Descriptions.Item>
          <Descriptions.Item label="工号">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="身份">
            <Tag color={isAdmin ? 'gold' : 'blue'}>
              {isAdmin ? '支部管理员' : '员工（党员）'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="所在党支部">
            {findLabel(BRANCHES, user?.branch) || '-'}
          </Descriptions.Item>
          {!isAdmin && (
            <>
              <Descriptions.Item label="岗位类型">
                {findLabel(POSITION_TYPES, user?.positionType) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="所在岗位">
                {findPositionLabel(user?.position) || '-'}
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          icon={<UserOutlined />}
          message="以上信息在注册时确定，本人不可修改；如需变更请联系所属支部管理员。"
        />
      </Card>
    </div>
  );
}
