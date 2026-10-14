import { useEffect, useMemo, useState } from 'react';
import {
  Form,
  Input,
  Button,
  AutoComplete,
  message,
  Alert,
  Space,
  Table,
  Popconfirm,
  Tabs,
  Typography,
  Tag,
  Select,
  Row,
  Col,
  Modal,
} from 'antd';
import {
  LogoutOutlined,
  DeleteOutlined,
  ToolOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/cloudbase';
import {
  ADMIN_TYPE_META,
  ADMIN_TYPE_SYSTEM,
  homePath,
  BRANCHES,
  POSITION_TYPES,
  getPositionsByType,
} from '../lib/constants';

const { Title, Text } = Typography;

// textarea 字符串 → 工号数组（逗号 / 换行 / 空格 / 分号）
const splitWorkIds = (s) =>
  String(s || '')
    .split(/[\s,，;；]+/)
    .map((x) => x.trim())
    .filter(Boolean);

// 身份下拉：去掉 ADMIN_TYPE_SYSTEM = 9（防误把普通用户加成系统管理员；
// 真要加 9 走专门逻辑更安全，这里先屏蔽）
const ADMIN_TYPE_OPTIONS = [
  { value: 0, label: '0 · 分管领导' },
  { value: 1, label: '1 · 组织委员' },
  { value: 2, label: '2 · 支部书记' },
  { value: 3, label: '3 · 普通党员' },
];

// 员工信息维护 Tab =====================================================
function UserManagementTab({ users, reload }) {
  const [form] = Form.useForm();
  const [selectedName, setSelectedName] = useState(undefined);
  const [selectedWorkId, setSelectedWorkId] = useState(undefined);
  // 当前表单里"加载自"哪个工号：null = 新建模式
  const [loadedWorkId, setLoadedWorkId] = useState(null);
  const [saving, setSaving] = useState(false);

  // ===== 姓名下拉：distinct(去重 + 排除系统管理员) =====
  const nameOptions = useMemo(() => {
    const names = Array.from(
      new Set(users.map((u) => u.name).filter(Boolean)),
    );
    return names.map((n) => ({ value: n, label: n }));
  }, [users]);

  // ===== 工号下拉：按姓名过滤 =====
  const workIdOptions = useMemo(() => {
    const list = selectedName
      ? users.filter((u) => u.name === selectedName)
      : users;
    return list
      .filter((u) => u.work_id && u.work_id !== 'superadmin')
      .map((u) => ({ value: u.work_id, label: `${u.work_id}　${u.name}` }));
  }, [users, selectedName]);

  // ===== 岗位下拉：跟岗位类型联动 =====
  const currentType = Form.useWatch('type', form);
  const jobOptions = useMemo(() => {
    const list = getPositionsByType(currentType) || [];
    return list.map((x) => ({ value: x.value, label: x.label }));
  }, [currentType]);

  // ===== 选中工号时，加载用户到表单 / 切到新建模式 =====
  useEffect(() => {
    if (!selectedWorkId) {
      form.resetFields();
      setLoadedWorkId(null);
      return;
    }
    const u = users.find((x) => x.work_id === selectedWorkId);
    if (u) {
      form.setFieldsValue({
        user_id: u.user_id,
        pw: '',
        name: u.name,
        work_id: u.work_id,
        admin_type: u.admin_type,
        type: u.type || undefined,
        job: u.job || undefined,
        branch: u.branch,
      });
      setLoadedWorkId(u.work_id);
    } else {
      // 新建模式：表单清空，只塞工号
      form.resetFields();
      form.setFieldsValue({ work_id: selectedWorkId });
      setLoadedWorkId(null);
    }
  }, [selectedWorkId, users, form]);

  const onSubmit = async (values) => {
    const workId = String(values.work_id || '').trim();
    if (!workId) {
      message.error('工号不能为空');
      return;
    }
    // 表单中的工号 vs 当前选中工号：可能用户编辑时改了工号
    // 只要 work_id 已存在 → UPDATE；否则 → INSERT（无白名单）
    const isNew = !users.some((u) => u.work_id === workId);

    if (isNew && !values.pw) {
      message.error('新建用户必须填写登录密码');
      return;
    }

    setSaving(true);
    try {
      const body = {
        user_id: String(values.user_id || '').trim(),
        name: String(values.name || '').trim(),
        work_id: workId,
        admin_type: Number(values.admin_type),
        type: values.type || null,
        job: values.job || null,
        branch: values.branch,
      };
      // 修改时：留空密码 = 不改；只在新模式 / 显式填了密码时传 pw
      if (values.pw) body.pw = String(values.pw);

      const res = await apiRequest('/api/backdoor/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.code === 'OK') {
        message.success(isNew ? '已新建用户' : '已修改用户');
        await reload();
        // 切到「已加载」状态（无论是新建还是修改）
        setSelectedWorkId(workId);
        form.setFieldValue('pw', '');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    const workId = form.getFieldValue('work_id');
    if (!workId) {
      message.error('请先加载一个用户');
      return;
    }
    Modal.confirm({
      title: `确定删除工号 ${workId} 的用户？`,
      content: (
        <div>
          <p>该用户的：
            <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
              <li>登录账号、姓名、岗位信息</li>
              <li>所有未过期的会话（需要重新登录）</li>
              <li>作为审核人/被审核人的全部关系</li>
            </ul>
            都会被删除，操作不可撤销。
          </p>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await apiRequest(
            `/api/backdoor/users/${encodeURIComponent(workId)}`,
            { method: 'DELETE' },
          );
          if (res.code === 'OK') {
            message.success('已删除');
            form.resetFields();
            setLoadedWorkId(null);
            setSelectedName(undefined);
            setSelectedWorkId(undefined);
            await reload();
          } else {
            message.error(res.message || '删除失败');
          }
        } catch (e) {
          message.error(e.message || '删除失败');
        }
      },
    });
  };

  const onClear = () => {
    form.resetFields();
    setLoadedWorkId(null);
    setSelectedName(undefined);
    setSelectedWorkId(undefined);
  };

  // 当前加载的工号是否还能"删除"（不能删系统管理员；新建未保存时也不能删）
  const currentWorkId = form.getFieldValue('work_id');
  const isLoadedExisting = loadedWorkId && currentWorkId === loadedWorkId;
  const isSystemUser = currentWorkId === 'superadmin';

  return (
    <>
      {/* 查询 / 加载区 */}
      <div
        style={{
          background: '#fff',
          padding: 24,
          marginBottom: 16,
          borderRadius: 8,
        }}
      >
        <Title level={4} style={{ marginTop: 0 }}>
          查询 / 加载用户
        </Title>
        <Text type="secondary">
          先选姓名 / 工号定位用户 → 下方表单自动加载。直接输入「不存在的工号」则进入新建模式。
        </Text>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4 }}>
              <Text>姓名</Text>
            </div>
            <AutoComplete
              value={selectedName}
              options={nameOptions}
              onChange={(v) => setSelectedName(v || undefined)}
              onSelect={(v) => setSelectedName(v)}
              style={{ width: '100%' }}
              placeholder="选/输入姓名（自动联想）"
              allowClear
              filterOption={(input, opt) =>
                (opt?.value || '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4 }}>
              <Text>工号</Text>
            </div>
            <AutoComplete
              value={selectedWorkId}
              options={workIdOptions}
              onChange={(v) => setSelectedWorkId(v || undefined)}
              onSelect={(v) => setSelectedWorkId(v)}
              style={{ width: '100%' }}
              placeholder="选/输入工号；新工号=新建"
              allowClear
              filterOption={(input, opt) =>
                (opt?.value || '').toLowerCase().includes(input.toLowerCase()) ||
                (opt?.label || '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Col>
          <Col xs={24} sm={24} md={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Space>
              <Button onClick={onClear} icon={<ReloadOutlined />}>
                清空
              </Button>
              {isLoadedExisting && !isSystemUser && (
                <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                  删除该用户
                </Button>
              )}
            </Space>
          </Col>
        </Row>
      </div>

      {/* 编辑表单 */}
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            {isLoadedExisting
              ? '编辑用户'
              : loadedWorkId === null && currentWorkId
              ? '新建用户'
              : '编辑 / 新建'}
          </Title>
          <Space>
            {isLoadedExisting && <Tag color="blue">已加载</Tag>}
            {!isLoadedExisting && currentWorkId && <Tag color="green">新建模式</Tag>}
            {isSystemUser && <Tag color="red">系统管理员</Tag>}
          </Space>
        </div>

        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="user_id"
                label="登录账号（user_id）"
                rules={[{ required: true, message: '请填写登录账号' }]}
                extra="登录用的账号，全局唯一"
              >
                <Input placeholder="如 zhangsan" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="pw"
                label="登录密码"
                rules={[
                  {
                    validator: (_, value) => {
                      // 留空始终允许（"不修改"语义）
                      if (!value) return Promise.resolve();
                      if (String(value).length < 4)
                        return Promise.reject(new Error('密码至少 4 位'));
                      return Promise.resolve();
                    },
                  },
                ]}
                extra={
                  isLoadedExisting
                    ? '留空 = 不修改原密码；填了则覆盖'
                    : '新建用户：必填（至少 4 位）'
                }
              >
                <Input.Password
                  placeholder={isLoadedExisting ? '不修改请留空' : '请输入初始密码'}
                  autoComplete="new-password"
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="姓名"
                rules={[{ required: true, message: '请填写姓名' }]}
              >
                <Input placeholder="如 张三" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="work_id"
                label="工号（work_id）"
                rules={[{ required: true, message: '请填写工号' }]}
                extra={
                  isLoadedExisting
                    ? '改工号 = 给新工号建一条新记录，原记录保留'
                    : '新建用户时：填入要使用的工号（已存在则改为更新）'
                }
              >
                <Input placeholder="如 W-0001" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="admin_type"
                label="身份（admin_type）"
                rules={[{ required: true, message: '请选择身份' }]}
              >
                <Select options={ADMIN_TYPE_OPTIONS} placeholder="选择身份" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="type" label="岗位类型">
                <Select
                  allowClear
                  options={POSITION_TYPES.map((t) => ({
                    value: t.value,
                    label: t.label,
                  }))}
                  placeholder="选岗位类型（决定岗位选项）"
                  onChange={() => form.setFieldValue('job', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="job" label="岗位">
                <Select
                  allowClear
                  options={jobOptions}
                  placeholder={currentType ? '选岗位' : '先选岗位类型'}
                  disabled={!currentType}
                  notFoundContent={currentType ? '无选项' : '请先选岗位类型'}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="branch"
                label="所在支部"
                rules={[{ required: true, message: '请选择所在支部' }]}
              >
                <Select
                  allowClear
                  options={BRANCHES.map((b) => ({ value: b.value, label: b.label }))}
                  placeholder="选择党支部"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space wrap>
              <Button
                type="primary"
                htmlType="submit"
                icon={<PlusOutlined />}
                loading={saving}
              >
                保存
              </Button>
              <Button onClick={onClear} icon={<ReloadOutlined />}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </div>
    </>
  );
}

// 审核关系维护 Tab =====================================================
function ReviewAssignmentsTab({ users, assignments, loading, reload }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // 表格多选：跨分页保留 selectedRowKeys（rowSelection.preserveSelectedRowKeys）
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  // 任意人都可以当审核人/被审核人 → 下拉不过滤 admin_type，只排除系统管理员自己
  const userOptions = useMemo(
    () =>
      users
        .filter((u) => u.work_id && u.work_id !== 'superadmin')
        .map((u) => ({
          value: u.work_id,
          label: `${u.work_id}　${u.name}（${ADMIN_TYPE_META[u.admin_type]?.text || ''}）`,
        })),
    [users],
  );

  // 把 rowKey 解析回 (reviewer, reviewee)，用于批量删除
  const keyToPair = useMemo(() => {
    const m = new Map();
    assignments.forEach((a) => {
      m.set(`${a.reviewer_work_id}||${a.target_work_id}`, {
        reviewer: a.reviewer_work_id,
        reviewee: a.target_work_id,
      });
    });
    return m;
  }, [assignments]);

  // 当前页选中的 key（仅用于"全选/反选"提示），全部选中以 selectedRowKeys 为准
  const onDeleteSelected = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选要删除的关系');
      return;
    }
    Modal.confirm({
      title: `确定删除选中的 ${selectedRowKeys.length} 条审核关系？`,
      content: '删除后对应人员将不再出现在彼此的审核范围里，操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const pairs = selectedRowKeys
          .map((k) => keyToPair.get(k))
          .filter(Boolean);
        try {
          const res = await apiRequest('/api/backdoor/assignments', {
            method: 'DELETE',
            body: JSON.stringify({ pairs }),
          });
          if (res.code === 'OK') {
            message.success(`已删除 ${res.data.deleted} 条`);
            setSelectedRowKeys([]);
            await reload();
          } else {
            message.error(res.message || '删除失败');
          }
        } catch (e) {
          message.error(e.message || '删除失败');
        }
      },
    });
  };

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      const reviewer = String(values.reviewer).trim();
      const reviewees = splitWorkIds(values.reviewees);
      if (reviewees.length === 0) {
        message.error('请填写至少一个被审核人工号');
        return;
      }
      const res = await apiRequest('/api/backdoor/assignments', {
        method: 'POST',
        body: JSON.stringify({ reviewer, reviewees }),
      });
      if (res.code === 'OK') {
        const { added, alreadyExists } = res.data;
        message.success(
          added > 0
            ? `已写入 ${added} 条；已存在 ${alreadyExists} 条`
            : `全部 ${alreadyExists} 条都已存在，未新增`,
        );
        form.resetFields();
        await reload();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteOne = async (rv, tg) => {
    try {
      const res = await apiRequest('/api/backdoor/assignments', {
        method: 'DELETE',
        body: JSON.stringify({ reviewer: rv, reviewees: [tg] }),
      });
      if (res.code === 'OK') {
        message.success(`已删除 ${res.data.deleted} 条`);
        await reload();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (e) {
      message.error(e.message || '删除失败');
    }
  };

  const columns = [
    { title: '审核人工号', dataIndex: 'reviewer_work_id', width: 110 },
    {
      title: '审核人',
      dataIndex: 'reviewer_name',
      width: 100,
      render: (v) => v || <Text type="secondary">（已注销）</Text>,
    },
    {
      title: '审核人身份',
      width: 100,
      render: (_, r) => {
        const t = ADMIN_TYPE_META[r.reviewer_admin_type]?.text;
        return t ? <Tag color={ADMIN_TYPE_META[r.reviewer_admin_type].color}>{t}</Tag> : '-';
      },
    },
    { title: '被审核人工号', dataIndex: 'target_work_id', width: 110 },
    {
      title: '被审核人',
      dataIndex: 'target_name',
      width: 100,
      render: (v) => v || <Text type="secondary">（已注销）</Text>,
    },
    {
      title: '被审核人身份',
      width: 100,
      render: (_, r) => {
        const t = ADMIN_TYPE_META[r.target_admin_type]?.text;
        return t ? <Tag color={ADMIN_TYPE_META[r.target_admin_type].color}>{t}</Tag> : '-';
      },
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_, r) => (
        <Popconfirm
          title="删除这条关系？"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDeleteOne(r.reviewer_work_id, r.target_work_id)}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          background: '#fff',
          padding: 24,
          marginBottom: 16,
          borderRadius: 8,
        }}
      >
        <Title level={4} style={{ marginTop: 0 }}>
          新增 / 追加 审核关系
        </Title>
        <Text type="secondary">
          审核人填 1 个工号；被审核人填多个（用逗号 / 换行 / 空格 / 分号分隔）。
          已存在的关系会被跳过，不重复插入；工号必须先在系统中注册过。
        </Text>
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="reviewer"
            label="审核人（1 个工号）"
            rules={[{ required: true, message: '请填写审核人工号' }]}
          >
            <AutoComplete
              options={userOptions}
              placeholder="如 W-0001（输入可联想）"
              filterOption={(input, opt) => {
                const q = input.toLowerCase();
                return (
                  (opt?.value || '').toLowerCase().includes(q) ||
                  (opt?.label || '').toLowerCase().includes(q)
                );
              }}
            />
          </Form.Item>
          <Form.Item
            name="reviewees"
            label="被审核人（多个工号）"
            rules={[{ required: true, message: '请填写被审核人工号' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder={
                'W-0007, W-0008, W-0009\n（也支持换行 / 空格 / 分号分隔）'
              }
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space wrap>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                htmlType="submit"
                loading={saving}
              >
                保存
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => form.resetFields()}
              >
                清空
              </Button>
              <Button onClick={reload} loading={loading}>
                刷新列表
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </div>

      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            现有审核关系（共 {assignments.length} 条）
          </Title>
          <Space wrap>
            {selectedRowKeys.length > 0 && (
              <>
                <Text type="secondary">已选中 {selectedRowKeys.length} 条</Text>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={onDeleteSelected}
                >
                  删除选中
                </Button>
                <Button size="small" onClick={() => setSelectedRowKeys([])}>
                  清空选择
                </Button>
              </>
            )}
          </Space>
        </div>
        <Table
          size="small"
          loading={loading}
          dataSource={assignments}
          rowKey={(r) => `${r.reviewer_work_id}||${r.target_work_id}`}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1000 }}
          columns={columns}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            preserveSelectedRowKeys: true,
            fixed: 'left',
            columnWidth: 48,
          }}
        />
      </div>
    </>
  );
}

// 主页面 ==============================================================
export default function Backdoor() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);

  // 鉴权：必须是 admin_type=9（系统管理员）；否则跳走
  useEffect(() => {
    if (!user) {
      nav('/login', { replace: true });
      return;
    }
    if (user.adminType !== ADMIN_TYPE_SYSTEM) {
      message.error('无权访问系统管理工具');
      nav(homePath(user), { replace: true });
    }
  }, [user, nav]);

  const reload = async () => {
    setLoading(true);
    try {
      const [u, a] = await Promise.all([
        apiRequest('/api/backdoor/users'),
        apiRequest('/api/backdoor/assignments'),
      ]);
      setUsers(u?.data || []);
      setAssignments(a?.data || []);
    } catch (e) {
      message.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.adminType === ADMIN_TYPE_SYSTEM) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleLogout = () => {
    logout();
    nav('/login', { replace: true });
  };

  // 等鉴权 useEffect 跑完再渲染（避免越权页闪一下）
  if (!user || user.adminType !== ADMIN_TYPE_SYSTEM) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* 顶部：标题 + 用户信息 + 退出 */}
        <div
          style={{
            background: '#fff',
            padding: '16px 24px',
            borderRadius: 8,
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <Space size="middle" wrap>
            <ToolOutlined style={{ fontSize: 24, color: '#b71c1c' }} />
            <Title level={3} style={{ margin: 0 }}>
              系统管理工具
            </Title>
            <Tag color="red">仅系统管理员可见</Tag>
          </Space>
          <Space>
            <Text type="secondary">
              {user.name}（{user.work_id}）
            </Text>
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>
              退出
            </Button>
          </Space>
        </div>

        <Alert
          type="warning"
          showIcon
          message="本页为系统维护工具。所有操作直接写入数据库，请谨慎使用。"
          style={{ marginBottom: 16 }}
        />

        <Tabs
          defaultActiveKey="user-management"
          items={[
            {
              key: 'user-management',
              label: (
                <span>
                  <UserOutlined />
                  员工信息维护
                </span>
              ),
              children: <UserManagementTab users={users} reload={reload} />,
            },
            {
              key: 'review-assignments',
              label: '审核关系维护',
              children: (
                <ReviewAssignmentsTab
                  users={users}
                  assignments={assignments}
                  loading={loading}
                  reload={reload}
                />
              ),
            },
            {
              key: 'placeholder-3',
              label: '更多工具（占位）',
              children: (
                <div
                  style={{
                    background: '#fff',
                    padding: 24,
                    borderRadius: 8,
                    textAlign: 'center',
                  }}
                >
                  <Text type="secondary">更多维护工具待添加</Text>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
