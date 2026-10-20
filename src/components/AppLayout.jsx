import { useMemo, useState } from 'react';
import { Layout, Menu, Dropdown, Avatar, Tag, Space, Drawer, Button } from 'antd';
import { LogoutOutlined, UserOutlined, MenuOutlined } from '@ant-design/icons';
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
import { useIsMobile } from '../lib/useIsMobile';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout, can, menuOrder } = useAuth();

  // 侧边菜单：定义统一在 src/lib/menu.js（新增模块只改那里）
  // ① 按权限过滤（无权限的项不出现）
  //   员工          → 自评
  //   支部书记(0)   → 履职贡献评价审核
  //   分管领导(4)   → 只有「履职贡献评价审核」一项，且恒出现（没被指派人也能进）
  //   组织委员(1)   → 基础积分评价
  //   党总支书记(2)   → 同时显示「履职贡献评价审核」+「基础积分评价」两项
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

  // 窄屏（视口 < 768px）：缩小留白、隐藏顶栏副标题；>= 992px 与原来完全一致
  const isMobile = useIsMobile();
  // 侧边栏折叠态：< 992px 时 antd 会把 Sider 折叠到 0 宽（触发器也一起看不见），
  //   此时改用顶栏的菜单按钮 + Drawer 打开**同一份**菜单，保证窄屏也有入口
  const [siderBroken, setSiderBroken] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const onMenuClick = ({ key }) => {
    nav(key);
    setDrawerOpen(false);
  };

  const meta = ADMIN_TYPE_META[user?.adminType] || { text: '未知', color: 'default' };

  // 副标题：普通党员显示岗位；其余身份显示所在支部
  //   （党总支书记不再标注「可见全体」—— 审核范围已改由 review_assignment 决定）
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
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        theme="dark"
        onBreakpoint={setSiderBroken}
      >
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
          onClick={onMenuClick}
        />
      </Sider>

      {/* 侧边栏折叠时（< 992px）的替代入口：顶栏按钮 → 左侧抽屉，菜单与侧边栏同一份 */}
      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={220}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <div
          style={{
            color: '#fff',
            textAlign: 'center',
            padding: '20px 0',
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 2,
            background: 'linear-gradient(135deg, #b71c1c 0%, #d32f2f 60%, #f57c00 100%)',
          }}
        >
          ⭐ 党员评价
        </div>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={items}
          onClick={onMenuClick}
        />
      </Drawer>
      <Layout>
        <Header
          className="brand-gradient"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: isMobile ? '0 12px' : '0 24px',
          }}
        >
          <div
            style={{
              fontSize: isMobile ? 16 : 18,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            {/* 侧边栏折叠时才出现：窄屏没有它就没有导航入口 */}
            {siderBroken && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setDrawerOpen(true)}
                style={{ color: '#fff' }}
              />
            )}
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
            <Space style={{ color: '#fff', cursor: 'pointer' }} size={isMobile ? 4 : 8}>
              <Avatar icon={<UserOutlined />} style={{ background: '#fff', color: '#b71c1c' }} />
              <span>{user?.name || '匿名'}</span>
              {!isMobile && <Tag color={meta.color}>{meta.text}</Tag>}
              {/* 副标题（岗位 / 所属支部）窄屏隐藏，否则会把用户名挤没 */}
              {!isMobile && subInfo && (
                <span style={{ fontSize: 12, opacity: 0.85 }}>· {subInfo}</span>
              )}
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: isMobile ? 8 : 16 }}>
          <div
            style={{
              background: '#fff',
              padding: isMobile ? 12 : 24,
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