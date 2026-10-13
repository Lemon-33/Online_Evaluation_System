import { Layout, Menu, Dropdown, Avatar, Tag, Space } from 'antd';
import {
  EditOutlined,
  AuditOutlined,
  TableOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLES, ROLE_META, findLabel, POSITION_TYPES, BRANCHES, findPositionLabel } from '../lib/constants';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, can } = useAuth();

  const items = [
    can('self') && {
      key: '/self',
      icon: <EditOutlined />,
      label: '党员自评',
    },
    can('review') && {
      key: '/review',
      icon: <AuditOutlined />,
      label: '审核评价',
    },
    can('list') && {
      key: '/list',
      icon: <TableOutlined />,
      label: '评价汇总',
    },
  ].filter(Boolean);

  const modeLabel =
    user?.role === ROLES.ADMIN ? '管理员审核模式' : '党员自评模式';
  const modeColor = user?.role === ROLES.ADMIN ? '#fffbe6' : '#e6f7ff';

  const meta = ROLE_META[user?.role] || { text: '未知', color: 'default' };

  // 副标题：两者都显示所在支部；员工额外显示岗位 / 类型
  const branchInfo = user?.branch ? findLabel(BRANCHES, user.branch) : '';
  const subInfo =
    user?.role === ROLES.EMPLOYEE
      ? `${findPositionLabel(user.position)} · ${findLabel(
          POSITION_TYPES,
          user.positionType
        )}${branchInfo ? ` · ${branchInfo}` : ''}`
      : user?.role === ROLES.ADMIN
      ? `所属：${branchInfo}`
      : '';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" theme="dark">
        <div
          style={{
            color: '#fff',
            textAlign: 'center',
            padding: '20px 0',
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 2,
            background: 'rgba(255,255,255,0.05)',
          }}
        >
          ⭐ 党员评价
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={items}
          onClick={({ key }) => nav(key)}
        />
      </Sider>
      <Layout>
        <Header
          className="brand-gradient"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 24px',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>党员评价系统</span>
            <span
              style={{
                fontSize: 12,
                padding: '2px 10px',
                background: modeColor,
                color: user?.role === ROLES.ADMIN ? '#ad6800' : '#096dd9',
                borderRadius: 12,
                fontWeight: 500,
              }}
            >
              {modeLabel}
            </span>
          </div>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'profile',
                  icon: <UserOutlined />,
                  label: '个人信息',
                  onClick: () => nav('/profile'),
                },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => {
                    logout();
                    nav('/login', { replace: true });
                  },
                },
              ],
            }}
          >
            <Space style={{ color: '#fff', cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} style={{ background: '#fff', color: '#b71c1c' }} />
              <span>{user?.name || '匿名'}</span>
              <Tag color={meta.color}>{meta.text}</Tag>
              {subInfo && <span style={{ fontSize: 12, opacity: 0.85 }}>· {subInfo}</span>}
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              minHeight: 'calc(100vh - 112px)',
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}