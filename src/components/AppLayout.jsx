import { useMemo } from 'react';
import { Layout, Menu, Dropdown, Avatar, Tag, Space } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ADMIN_TYPE_META,
  ADMIN_TYPE_EMPLOYEE,
  findLabel,
  POSITION_TYPES,
  BRANCHES,
  findPositionLabel,
} from '../lib/constants';
import { MENU_ITEMS, sortMenuItems } from '../lib/menu';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, can, menuOrder } = useAuth();

  // 侧边菜单：定义统一在 src/lib/menu.js（新增模块只改那里）
  // ① 按权限过滤（无权限的项不出现）
  //   员工          → 自评
  //   分管领导(0)   → 履职贡献评价审核
  //   组织委员(1)   → 基础积分评价
  //   支部书记(2)   → 同时显示「履职贡献评价审核」+「基础积分评价」两项
  //                  审核入口恒有，但审核范围不再是「全支部」：
  //                  与其他人一样由 review_assignment 决定，刚注册时为空
  //   注：原「评价汇总 / 导出」入口已下线（2026-10-15），路由 /list 已移除
  // ② 再按本人保存的顺序排序（menuOrder 来自「个人信息 → 侧边栏排序」；
  //    没排过的项 / 新增模块自动排到末尾，保持 MENU_ITEMS 里的默认顺序）
  const items = useMemo(() => {
    const visible = MENU_ITEMS.filter((it) => can(it.perm));
    const ordered = sortMenuItems(visible, menuOrder);
    return ordered.map((it) => {
      const Icon = it.icon;
      return { key: it.key, icon: <Icon />, label: it.label };
    });
  }, [can, menuOrder]);

  const meta = ADMIN_TYPE_META[user?.adminType] || { text: '未知', color: 'default' };

  // 副标题：普通党员显示岗位；其余身份显示所在支部
  //   （支部书记不再标注「可见全体」—— 审核范围已改由 review_assignment 决定）
  const branchInfo = user?.branch ? findLabel(BRANCHES, user.branch) : '';
  const isEmployee = user?.adminType === ADMIN_TYPE_EMPLOYEE;
  const subInfo = isEmployee
    ? `${findPositionLabel(user.position)} · ${findLabel(
        POSITION_TYPES,
        user.positionType
      )}${branchInfo ? ` · ${branchInfo}` : ''}`
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