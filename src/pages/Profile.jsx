import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Table, Tag, message } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MenuOutlined,
  ReloadOutlined,
  UserOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import {
  ROLES,
  ADMIN_TYPE_META,
  POSITION_TYPES,
  BRANCHES,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { MENU_ITEMS, moveMenuItem, sortMenuItems } from '../lib/menu';
import { saveMyMenuOrder } from '../lib/cloudbase';

// 侧边栏排序：用户自定义各模块的排列顺序
// ------------------------------------------------------------
// 只排「当前有权限看到」的模块；顺序存服务端（user_menu_order 表，按工号一人一行），
// 换浏览器/换设备登录仍然是自己排好的顺序。保存后侧边栏立即生效（不用刷新）。
// 恢复默认 = 保存一个空数组：前端 sortMenuItems 会把未排序的项按默认顺序排。
function SidebarOrderCard() {
  const { can, menuOrder, setMenuOrder } = useAuth();
  const [list, setList] = useState([]); // 当前可见模块（顺序可改）
  const [saving, setSaving] = useState(false);

  // 权限 / 已保存顺序变化时，用「默认顺序 + 已保存顺序」重置列表
  useEffect(() => {
    const visible = MENU_ITEMS.filter((it) => can(it.perm));
    setList(sortMenuItems(visible, menuOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, menuOrder]);

  const move = (index, delta) => setList((prev) => moveMenuItem(prev, index, delta));

  // 保存：只存 key 数组
  const save = async (keys) => {
    setSaving(true);
    try {
      const saved = await saveMyMenuOrder(keys);
      setMenuOrder(Array.isArray(saved) ? saved : keys);
      message.success(keys.length ? '侧边栏顺序已保存' : '已恢复默认顺序');
    } catch (e) {
      console.error(e);
      message.error(e?.message || '保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    {
      title: '顺序',
      width: 70,
      align: 'center',
      render: (_, __, i) => <Tag color="blue">{i + 1}</Tag>,
    },
    {
      title: '模块',
      align: 'center',
      render: (_, it) => {
        const Icon = it.icon;
        return (
          <Space>
            {Icon ? <Icon /> : null}
            <span>{it.label}</span>
          </Space>
        );
      },
    },
    {
      title: '调整',
      width: 140,
      align: 'center',
      render: (_, __, i) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={i === 0}
            onClick={() => move(i, -1)}
          />
          <Button
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={i === list.length - 1}
            onClick={() => move(i, 1)}
          />
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <MenuOutlined style={{ color: '#b71c1c' }} />
          <span>侧边栏排序</span>
        </Space>
      }
      style={{ marginTop: 16 }}
      extra={
        <Button
          icon={<ReloadOutlined />}
          loading={saving}
          onClick={() => save([])} // 空数组 = 恢复默认顺序
        >
          恢复默认
        </Button>
      }
    >
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={list}
        locale={{ emptyText: '当前账号没有可排序的模块' }}
      />
      <Space style={{ marginTop: 16 }}>
        <Button
          type="primary"
          loading={saving}
          disabled={!list.length}
          onClick={() => save(list.map((it) => it.key))}
        >
          保存顺序
        </Button>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
          调整后点「保存顺序」，侧边栏立即生效（存到账号上，换设备登录也保留）
        </span>
      </Space>
    </Card>
  );
}

// 个人信息页：注册时确定的资料，只读展示 + 侧边栏排序偏好
// 入口：点击顶栏右上角自己的名字
export default function Profile() {
  const { user } = useAuth();
  const isAdmin = user?.role === ROLES.ADMIN;
  // adminType 0=分管领导, 1=组织委员（普通党员 admin=0, adminType 任意）
  const adminTypeText = isAdmin
    ? (ADMIN_TYPE_META[user?.adminType]?.text || '管理员')
    : null;

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
          {/* 对应数据库 user_table.user_id（登录账号），非工作证编号 */}
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="工作证编号">{user?.workId || '-'}</Descriptions.Item>
          <Descriptions.Item label="身份">
            <Space size={4}>
              <Tag color={isAdmin ? 'gold' : 'blue'}>
                {isAdmin ? '支部管理员' : '员工（党员）'}
              </Tag>
              {isAdmin && adminTypeText && (
                <Tag color={ADMIN_TYPE_META[user?.adminType]?.color || 'default'}>{adminTypeText}</Tag>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="所在党支部">
            {user?.branch ? findLabel(BRANCHES, user.branch) || '-' : '-'}
          </Descriptions.Item>
          {(user?.positionType || user?.position) && (
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

      {/* 侧边栏模块排序（个人偏好，存服务端） */}
      <SidebarOrderCard />
    </div>
  );
}
