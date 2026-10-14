import { Layout, Menu, Dropdown, Avatar, Tag, Space } from 'antd';
import {
  EditOutlined,
  AuditOutlined,
  LogoutOutlined,
  UserOutlined,
  StarOutlined,
  LineChartOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ADMIN_TYPE_META,
  ADMIN_TYPE_SECRETARY,
  ADMIN_TYPE_EMPLOYEE,
  findLabel,
  POSITION_TYPES,
  BRANCHES,
  findPositionLabel,
} from '../lib/constants';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, can } = useAuth();

  // 侧边菜单按权限显示：
  //   员工          → 自评
  //   分管领导(0)   → 履职贡献评价审核
  //   组织委员(1)   → 基础积分评价
  //   支部书记(2)   → 同时显示「履职贡献评价审核」+「基础积分评价」两项
  //                  （共用分管领导/组织委员的同一组页面，数据范围为全支部）
  //                  没有「评价汇总」（list 是分管领导专有）
  const items = [
    can('self') && {
      key: '/self',
      icon: <EditOutlined />,
      label: '每月履职贡献自评',
    },
    can('basicRatingView') && {
      key: '/basic-rating-view',
      icon: <EyeOutlined />,
      label: '基础积分评价查看',
    },
    can('review') && {
      key: '/review',
      icon: <AuditOutlined />,
      label: '履职贡献评价审核',
    },
    can('scoreQuery') && {
      key: '/score-query',
      icon: <LineChartOutlined />,
      label: '个人积分查询',
    },
    can('basicRating') && {
      key: '/basic-rating',
      icon: <StarOutlined />,
      label: '基础积分评价',
    },
  ].filter(Boolean);

  const meta = ADMIN_TYPE_META[user?.adminType] || { text: '未知', color: 'default' };

  // 副标题：普通党员显示岗位；分管领导/组织委员显示所在支部；支部书记显示「可见全体」
  const branchInfo = user?.branch ? findLabel(BRANCHES, user.branch) : '';
  const isSecretary = user?.adminType === ADMIN_TYPE_SECRETARY;
  const isEmployee = user?.adminType === ADMIN_TYPE_EMPLOYEE;
  const subInfo = isEmployee
    ? `${findPositionLabel(user.position)} · ${findLabel(
        POSITION_TYPES,
        user.positionType
      )}${branchInfo ? ` · ${branchInfo}` : ''}`
    : isSecretary
    ? '可见全体'
    : branchInfo
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
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            <span>党员评价系统</span>
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