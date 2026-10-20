import { useEffect, useMemo, useRef, useState } from 'react';
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
  Checkbox,
} from 'antd';
import {
  LogoutOutlined,
  DeleteOutlined,
  ToolOutlined,
  PlusOutlined,
  ProfileOutlined,
  ReloadOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/cloudbase';
import { clearAllData } from '../lib/userService';
import FormOverridePanel from '../components/FormOverridePanel';
import {
  ADMIN_TYPE_META,
  ADMIN_TYPE_SYSTEM,
  ADMIN_TYPE_SECRETARY,
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
  { value: 0, label: '0 · 支部书记' },
  { value: 1, label: '1 · 组织委员' },
  { value: 2, label: '2 · 党总支书记' },
  { value: 3, label: '3 · 普通党员' },
  { value: 4, label: '4 · 分管领导' },
];

// 员工信息维护 Tab =====================================================
// 导出给主应用侧边栏的 /user-admin 页复用（见 pages/UserAdmin.jsx）；
// 系统管理员的 /backdoor 页也用它 —— 同一份实现，没有复制代码
//
// 2026-10-19 调整：
//   · 不再支持「新建账号」：服务端 POST /api/backdoor/users 已移除 INSERT 分支
//     （以前还能"打一个不存在的工号"就建新号，现在只能改已有记录）
//   · 系统管理员在表单里**可以改工号**：服务端以 originalWorkId 定位行 + 新工号落库
//   · 其它被授权账号不能改工号（前端不变，全部交给后端闸门判）
//   · 旧参数 allowCreate 取消
export function UserManagementTab({ users, reload }) {
  const { user } = useAuth();
  // 「身份」只有系统管理员(9) 能改；2026-10-19 起撤销党总支书记的例外——
  //   提权/撤权是最敏感的权限点，统一走系统管理员这一条道；其余被授权账号进来只读
  const canEditAdminType = user?.adminType === ADMIN_TYPE_SYSTEM;
  const [form] = Form.useForm();
  // 单框定位：姓名或工号（与「权限管理」页同一套交互）
  //   keyword = 框里的原始文本；resolvedWorkId = 解析出来的工号（解析不出 → null）
  const [keyword, setKeyword] = useState(undefined);
  // 当前表单里"加载自"哪个工号：null = 新建模式
  const [loadedWorkId, setLoadedWorkId] = useState(null);
  const [saving, setSaving] = useState(false);

  // ===== 单框候选项：value = 工号，label = "工号　姓名" =====
  //   排除系统管理员（后端 GET /api/backdoor/users 已排除，这里再挡一层）：
  //   AutoComplete 是在本数组里做本地匹配的，数组里没有它 ——
  //   用户把姓名/工号手动打全了也不会出现联想项，选不中、也加载不出它的资料。
  //   两个条件都判：admin_type=9 与 work_id='superadmin' 命中任一即排除。
  const userOptions = useMemo(
    () =>
      users
        .filter(
          (u) =>
            u.work_id &&
            u.work_id !== 'superadmin' &&
            u.admin_type !== ADMIN_TYPE_SYSTEM,
        )
        .map((u) => ({ value: u.work_id, label: `${u.work_id}　${u.name}` })),
    [users],
  );

  // 把框里的文本解析成工号：先精确匹配工号，再精确匹配姓名（同名多人 → 解析不出，
  //   必须从下拉里点选，靠 label 里的工号区分）
  const resolvedWorkId = useMemo(() => {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return null;
    const byId = users.find((u) => String(u.work_id || '').toLowerCase() === q);
    if (byId) return byId.work_id;
    const byName = users.filter(
      (u) =>
        String(u.name || '').toLowerCase() === q &&
        u.work_id !== 'superadmin' &&
        u.admin_type !== ADMIN_TYPE_SYSTEM,
    );
    return byName.length === 1 ? byName[0].work_id : null;
  }, [keyword, users]);

  // 同名提示：框里的文本精确匹配到多个同名的人（且没解析出工号）→ 界面上给提示，
  //   让用户从下拉里按工号选。否则他敲完名字发现表单一直是空的，不知道为什么
  const ambiguousCount = useMemo(() => {
    if (resolvedWorkId) return 0;
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return 0;
    return users.filter(
      (u) =>
        String(u.name || '').toLowerCase() === q &&
        u.work_id !== 'superadmin' &&
        u.admin_type !== ADMIN_TYPE_SYSTEM,
    ).length;
  }, [keyword, resolvedWorkId, users]);

  // ===== 岗位下拉：跟岗位类型联动 =====
  const currentType = Form.useWatch('type', form);
  const jobOptions = useMemo(() => {
    const list = getPositionsByType(currentType) || [];
    return list.map((x) => ({ value: x.value, label: x.label }));
  }, [currentType]);

  // ===== 解析出工号 → 加载用户到表单；匹配不到 → 表单清空（不再"新建"）=====
  //   originalWorkId 由表单 hidden 字段记录，作为后端定位行的唯一锚点
  //   （form.setFieldsValue 时一并填入；用户改 work_id 时它不变）
  useEffect(() => {
    const raw = String(keyword || '').trim();
    if (!raw) {
      form.resetFields();
      setLoadedWorkId(null);
      return;
    }
    if (resolvedWorkId) {
      const u = users.find((x) => x.work_id === resolvedWorkId);
      if (u) {
        form.setFieldsValue({
          // 隐藏字段：用来告诉后端"我改的是哪一行"
          originalWorkId: u.work_id,
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
        return;
      }
    }
    // 匹配不到任何人 —— 不再有"新建模式"概念；只清空表单
    form.resetFields();
    setLoadedWorkId(null);
  }, [keyword, resolvedWorkId, users, form]);

  const onSubmit = async (values) => {
    const workId = String(values.work_id || '').trim();
    if (!workId) {
      message.error('工号不能为空');
      return;
    }
    // 必先加载一个用户才能保存（原工号 hidden 字段是后端定位行的唯一锚点）
    const origWid = String(values.originalWorkId || '').trim();
    if (!origWid) {
      message.error('请先在「查询 / 加载用户」区加载要修改的用户');
      return;
    }

    setSaving(true);
    try {
      const body = {
        // 必传：被修改行的"原工号"
        originalWorkId: origWid,
        user_id: String(values.user_id || '').trim(),
        name: String(values.name || '').trim(),
        work_id: workId,
        admin_type: Number(values.admin_type),
        type: values.type || null,
        job: values.job || null,
        branch: values.branch,
      };
      // 留空 = 不改密码；显式填了才覆盖
      if (values.pw) body.pw = String(values.pw);

      const res = await apiRequest('/api/backdoor/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.code === 'OK') {
        message.success('已保存');
        await reload();
        // 把 originalWorkId 同步到新工号，否则再保存时还是改的"老行"定位
        form.setFieldValue('originalWorkId', workId);
        setKeyword(workId);
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
            setKeyword(undefined);
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
    setKeyword(undefined);
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
          在一个框里输入姓名或工号定位用户 → 下方表单自动加载，
          改完点「保存」即修改该员工。本页只能修改已有员工，不能新建账号。
        </Text>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4 }}>
              <Text>姓名或工号</Text>
            </div>
            {/* 单框：与「权限管理」页一致。value 存框里的原文，
                由 resolvedWorkId 负责把它解析成具体工号（同名多人必须点下拉选） */}
            <AutoComplete
              value={keyword}
              options={userOptions}
              onChange={(v) => setKeyword(v || undefined)}
              style={{ width: '100%' }}
              placeholder="选/输入姓名或工号（自动联想）"
              allowClear
              filterOption={(input, opt) => {
                const q = String(input || '').trim().toLowerCase();
                if (!q) return true;
                return (
                  String(opt?.value || '').toLowerCase().includes(q) ||
                  String(opt?.label || '').toLowerCase().includes(q)
                );
              }}
            />
            {ambiguousCount > 1 && (
              <Text type="warning" style={{ fontSize: 12 }}>
                该姓名对应 {ambiguousCount} 人，请从下拉里按工号选择
              </Text>
            )}
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
            编辑用户
          </Title>
          <Space>
            {isLoadedExisting && <Tag color="blue">已加载</Tag>}
            {/* 系统管理员标签用 geekblue（与 constants.js 的 ADMIN_TYPE_META 一致，不用红） */}
            {isSystemUser && <Tag color="geekblue">系统管理员</Tag>}
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
                extra="留空 = 不修改原密码；填了则覆盖（至少 4 位）"
              >
                <Input.Password
                  placeholder="不修改请留空"
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
              {/* 工号：始终可编辑（不再是"新建工号"的新建模式，而是改名）
                  · 其它被授权账号：后端拒绝改（前端提示）
                  · 系统管理员：可以改，但新工号不能撞别人 */}
              <Form.Item
                name="work_id"
                label="工号（work_id）"
                rules={[{ required: true, message: '请填写工号' }]}
                extra={
                  canEditAdminType
                    ? '系统管理员可改工号：填新工号后保存即把这条记录的 work_id 改成新值；新工号不能与他人重复。'
                    : '工号只有系统管理员可以修改；其它账号改动会被后端拒绝。'
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
                extra={
                  canEditAdminType
                    ? undefined
                    : '身份只有系统管理员可以修改；本页其余信息可正常维护'
                }
              >
                <Select
                  options={ADMIN_TYPE_OPTIONS}
                  placeholder="选择身份"
                  disabled={!canEditAdminType}
                />
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

          {/* 隐藏字段：被修改行的"原工号"，后端靠它定位行；保存后会自动同步到新工号 */}
          <Form.Item name="originalWorkId" hidden>
            <Input />
          </Form.Item>

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
// 导出给主应用侧边栏的 /review-assign 页复用（见 pages/ReviewAssign.jsx）；
// 系统管理员的 /backdoor 页也用它 —— 同一份实现，没有复制代码
export function ReviewAssignmentsTab({ users, assignments, loading, reload }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // 表格多选：跨分页保留 selectedRowKeys（rowSelection.preserveSelectedRowKeys）
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  // 现有审核关系筛选：框里的原文 vs 真正生效的条件 —— 点「筛选」才把原文写进 applied，
  //   这样边打字边改列表不会抖；两个框都留空 = 不过滤
  const [filterReviewer, setFilterReviewer] = useState('');
  const [filterTarget, setFilterTarget] = useState('');
  const [appliedFilter, setAppliedFilter] = useState({ reviewer: '', target: '' });

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

  // 点「筛选」：把框里的原文写进生效条件。顺带清空勾选 ——
  //   否则被筛掉的行仍留在 selectedRowKeys 里，点「删除选中」会删掉看不见的关系
  const applyFilter = () => {
    setAppliedFilter({
      reviewer: filterReviewer.trim(),
      target: filterTarget.trim(),
    });
    setSelectedRowKeys([]);
  };

  // 重置：两个框和生效条件一起清空
  const resetFilter = () => {
    setFilterReviewer('');
    setFilterTarget('');
    setAppliedFilter({ reviewer: '', target: '' });
    setSelectedRowKeys([]);
  };

  // 按「审核人 / 被审核人」过滤：主要按姓名，也允许用工号片段匹配（只会多命中、不会漏）
  //   两个框都填 → 取交集（同时满足审核人与被审核人条件）
  const filteredAssignments = useMemo(() => {
    const rv = appliedFilter.reviewer.trim().toLowerCase();
    const tg = appliedFilter.target.trim().toLowerCase();
    if (!rv && !tg) return assignments;
    return assignments.filter((a) => {
      const rvOk =
        !rv ||
        String(a.reviewer_name || '').toLowerCase().includes(rv) ||
        String(a.reviewer_work_id || '').toLowerCase().includes(rv);
      const tgOk =
        !tg ||
        String(a.target_name || '').toLowerCase().includes(tg) ||
        String(a.target_work_id || '').toLowerCase().includes(tg);
      return rvOk && tgOk;
    });
  }, [assignments, appliedFilter]);

  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    { title: '审核人工号', dataIndex: 'reviewer_work_id', width: 110, align: 'center' },
    {
      title: '审核人',
      dataIndex: 'reviewer_name',
      width: 100,
      align: 'center',
      // 该工号还没注册 / 已注销 → 查不到姓名，就只显示工号（不写「已注销」之类的提示）
      render: (v, r) => v || r.reviewer_work_id || '-',
    },
    {
      title: '审核人身份',
      width: 100,
      align: 'center',
      render: (_, r) => {
        const t = ADMIN_TYPE_META[r.reviewer_admin_type]?.text;
        return t ? <Tag color={ADMIN_TYPE_META[r.reviewer_admin_type].color}>{t}</Tag> : '-';
      },
    },
    { title: '被审核人工号', dataIndex: 'target_work_id', width: 110, align: 'center' },
    {
      title: '被审核人',
      dataIndex: 'target_name',
      width: 100,
      align: 'center',
      // 同上：查不到姓名就只显示工号
      render: (v, r) => v || r.target_work_id || '-',
    },
    {
      title: '被审核人身份',
      width: 100,
      align: 'center',
      render: (_, r) => {
        const t = ADMIN_TYPE_META[r.target_admin_type]?.text;
        return t ? <Tag color={ADMIN_TYPE_META[r.target_admin_type].color}>{t}</Tag> : '-';
      },
    },
    {
      title: '操作',
      width: 90,
      align: 'center',
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
          已存在的关系会被跳过，不重复插入；工号不要求已注册 ——
          未注册的工号也能先建关系（列表里只显示工号、不显示姓名），对方注册后自动生效。
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
            {filteredAssignments.length === assignments.length
              ? `现有审核关系（共 ${assignments.length} 条）`
              : `现有审核关系（筛选出 ${filteredAssignments.length} 条 / 共 ${assignments.length} 条）`}
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
        {/* 筛选：两个框任一填了就生效（都填取交集）；都留空 = 看全部 */}
        <Space wrap size={12} style={{ marginBottom: 12 }}>
          <Input
            style={{ width: 200 }}
            value={filterReviewer}
            onChange={(e) => setFilterReviewer(e.target.value)}
            onPressEnter={applyFilter}
            placeholder="审核人姓名（也支持工号）"
            allowClear
          />
          <Input
            style={{ width: 200 }}
            value={filterTarget}
            onChange={(e) => setFilterTarget(e.target.value)}
            onPressEnter={applyFilter}
            placeholder="被审核人姓名（也支持工号）"
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilter}>
            筛选
          </Button>
          <Button icon={<ReloadOutlined />} onClick={resetFilter}>
            重置
          </Button>
        </Space>
        <Table
          size="small"
          loading={loading}
          dataSource={filteredAssignments}
          rowKey={(r) => `${r.reviewer_work_id}||${r.target_work_id}`}
          locale={{
            emptyText:
              assignments.length === 0
                ? '还没有任何审核关系'
                : '没有符合筛选条件的审核关系',
          }}
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
// 权限管理 Tab =========================================================
// 把「系统维护工具」开放给某个账号，或者从某个账号收回。
//   - 可授予的清单由后端下发（GET /api/backdoor/permissions），前端不硬编码，
//     避免两边对不上；「权限管理」本身不在清单里 —— 它硬校验 admin_type=9
//   - 授权落在 permission 表（work_id + tool），所有接口实时查库：
//     收回后对方下一个请求就会被拒，不用重启服务
//   - 体验上的小延迟：对方已登录的会话里，侧边栏菜单要等他重新登录后才更新
function PermissionTab() {
  const [tools, setTools] = useState([]); // [{ key, label, desc }]
  const [grants, setGrants] = useState([]); // 已有授权
  const [users, setUsers] = useState([]); // 选人用名单
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState(undefined); // 选中的工号
  const [checked, setChecked] = useState([]); // 勾选的功能

  // 「已有特殊权限」筛选：框里的原文 vs 生效条件（点「筛选」后才写入）
  const [grantFilter, setGrantFilter] = useState('');
  const [appliedGrantFilter, setAppliedGrantFilter] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        apiRequest('/api/backdoor/permissions'),
        apiRequest('/api/backdoor/users'),
      ]);
      setTools(p?.data?.tools || []);
      setGrants(p?.data?.grants || []);
      setUsers(u?.data || []);
    } catch (e) {
      message.error(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // 选人下拉：排除系统管理员自己（他本来就拥有全部功能）
  const userOptions = useMemo(
    () =>
      users
        .filter((u) => u.work_id && u.work_id !== 'superadmin')
        .map((u) => ({ value: u.work_id, label: `${u.work_id}　${u.name}` })),
    [users]
  );

  // 当前选中的人已经拥有的功能：勾选项置灰，避免重复开放
  const owned = useMemo(
    () => new Set(grants.filter((g) => g.work_id === picked).map((g) => g.tool)),
    [grants, picked]
  );

  const toolLabel = (key) => tools.find((t) => t.key === key)?.label || key;

  const onGrant = async () => {
    if (!picked) {
      message.error('请先选择要开放的账号');
      return;
    }
    const add = checked.filter((t) => !owned.has(t));
    if (!add.length) {
      message.error('请勾选至少一个「尚未开放」的功能');
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest('/api/backdoor/permissions', {
        method: 'POST',
        body: JSON.stringify({ work_id: picked, tools: add }),
      });
      if (res.code === 'OK') {
        message.success('已开放');
        setChecked([]);
        await reload();
      } else {
        message.error(res.message || '开放失败');
      }
    } catch (e) {
      message.error(e.message || '开放失败');
    } finally {
      setSaving(false);
    }
  };

  const onRevoke = async (row) => {
    try {
      const res = await apiRequest('/api/backdoor/permissions', {
        method: 'DELETE',
        body: JSON.stringify({ work_id: row.work_id, tools: [row.tool] }),
      });
      if (res.code === 'OK') {
        message.success(`已收回「${toolLabel(row.tool)}」`);
        await reload();
      } else {
        message.error(res.message || '收回失败');
      }
    } catch (e) {
      message.error(e.message || '收回失败');
    }
  };

  // 点「筛选」把框里的原文写进生效条件；留空 = 看全部
  const applyGrantFilter = () => setAppliedGrantFilter(grantFilter.trim());
  const resetGrantFilter = () => {
    setGrantFilter('');
    setAppliedGrantFilter('');
  };

  // 按姓名筛选（也允许用工号片段匹配）：只看某个账号拥有的全部特殊权限
  const filteredGrants = useMemo(() => {
    const q = appliedGrantFilter.trim().toLowerCase();
    if (!q) return grants;
    return grants.filter(
      (g) =>
        String(g.name || '').toLowerCase().includes(q) ||
        String(g.work_id || '').toLowerCase().includes(q)
    );
  }, [grants, appliedGrantFilter]);

  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    { title: '姓名', dataIndex: 'name', width: 120, align: 'center', render: (v) => v || '-' },
    { title: '工号', dataIndex: 'work_id', width: 140, align: 'center' },
    {
      title: '已开放的功能',
      dataIndex: 'tool',
      width: 180,
      align: 'center',
      render: (v) => <Tag color="blue">{toolLabel(v)}</Tag>,
    },
    {
      title: '授予人',
      dataIndex: 'granted_by_name',
      width: 140,
      align: 'center',
      render: (v, row) => v || row.granted_by || '-',
    },
    { title: '授予时间', dataIndex: 'created_at', width: 170, align: 'center' },
    {
      title: '操作',
      width: 100,
      align: 'center',
      render: (_, row) => (
        <Popconfirm
          title={`收回「${toolLabel(row.tool)}」？`}
          description={`${row.name || ''}（${row.work_id}）将不能再使用该功能`}
          okText="收回"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onRevoke(row)}
        >
          <Button size="small" type="link" danger icon={<DeleteOutlined />}>
            收回
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="把系统维护功能开放给指定账号"
        description={
          <>
            开放后，该账号需要<strong>重新登录一次</strong>，主应用侧边栏才会出现对应菜单。
            收回则立即生效（接口会马上拒绝），但对方侧边栏要等他重新登录后才消失。
            权限管理本身不可开放，它只属于系统管理员。
          </>
        }
      />

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>1 · 选择账号</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                可输入姓名或工号联想；只列出已注册的账号
              </Text>
            </div>
            <AutoComplete
              style={{ width: 360 }}
              value={picked}
              options={userOptions}
              onChange={(v) => {
                setPicked(v || undefined);
                setChecked([]);
              }}
              placeholder="例：W-0009 或 张三"
              allowClear
              filterOption={(input, opt) => {
                const q = String(input || '').trim().toLowerCase();
                if (!q) return true;
                return (
                  String(opt?.value || '').toLowerCase().includes(q) ||
                  String(opt?.label || '').toLowerCase().includes(q)
                );
              }}
            />
          </div>

          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>2 · 勾选要开放的功能</Text>
              {picked && owned.size > 0 && (
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  已开放的会置灰，不用重复勾
                </Text>
              )}
            </div>
            {/* 一个功能占一行：Checkbox.Group 默认横向排，说明文字会挤在一起；
                这里改成纵向 Space + 逐个 Checkbox，自己维护勾选数组 */}
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {tools.map((t) => (
                <Checkbox
                  key={t.key}
                  checked={checked.includes(t.key)}
                  disabled={owned.has(t.key)}
                  onChange={(e) =>
                    setChecked((prev) =>
                      e.target.checked
                        ? [...prev, t.key]
                        : prev.filter((k) => k !== t.key)
                    )
                  }
                >
                  <span>
                    {t.label}
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      {t.desc}
                    </Text>
                  </span>
                </Checkbox>
              ))}
            </Space>
          </div>

          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={saving}
            disabled={!picked}
            onClick={onGrant}
          >
            开放
          </Button>
        </Space>
      </div>

      <Space wrap size={12}>
        <Input
          style={{ width: 240 }}
          value={grantFilter}
          onChange={(e) => setGrantFilter(e.target.value)}
          onPressEnter={applyGrantFilter}
          placeholder="输入姓名筛选（也支持工号）"
          allowClear
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={applyGrantFilter}>
          筛选
        </Button>
        <Button icon={<ReloadOutlined />} onClick={resetGrantFilter}>
          重置
        </Button>
      </Space>

      <Table
        rowKey={(row) => `${row.work_id}::${row.tool}`}
        title={() =>
          filteredGrants.length === grants.length
            ? `已有特殊权限（共 ${grants.length} 条）`
            : `已有特殊权限（筛选出 ${filteredGrants.length} 条 / 共 ${grants.length} 条）`
        }
        size="small"
        loading={loading}
        dataSource={filteredGrants}
        columns={columns}
        pagination={false}
        locale={{
          emptyText:
            grants.length === 0
              ? '还没有给任何账号开放特殊功能'
              : '没有符合筛选条件的记录',
        }}
      />
    </Space>
  );
}

// 「清除数据」的前两次确认：step = 1 / 2
//   （第 3 次不是普通确认，而是「输入清除口令」弹窗，见组件内的 askClearPassword）
//   返回 Promise<boolean> —— 只有点了「确定」才 resolve(true)；
//   点「取消」、点右上角叉号、按 ESC → resolve(false)，调用方据此**立刻终止**整个流程。
//   （Modal.confirm 的关闭/取消统一走 onCancel，所以叉掉弹窗等于点「否」）
const CLEAR_CONFIRM_STEPS = {
  1: {
    title: '清除数据 · 第 1 / 3 次确认',
    content:
      '此操作将清空数据库里的全部业务数据：员工账号、履职自评、履职评分、基础积分、个人荣誉、行为扣分、审核关系、个人卷子、工具授权，以及所有人的登录状态。只会保留你当前的超级管理员账号。',
    okText: '是，我已了解',
  },
  2: {
    title: '清除数据 · 第 2 / 3 次确认',
    content:
      '再确认一次：所有员工的账号和历史记录会被永久删除，无法恢复。清空后所有人需要重新注册，全部评价与评分需要重做。',
    okText: '是，继续',
  },
};

const askClearConfirm = (step) =>
  new Promise((resolve) => {
    // done 防重入：确定/取消只认第一次，避免连点导致 resolve 两次
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const s = CLEAR_CONFIRM_STEPS[step];
    Modal.confirm({
      title: s.title,
      content: s.content,
      okText: s.okText,
      cancelText: '取消',
      okButtonProps: { danger: true },
      // 点「确定」→ true；点「取消」或叉掉弹窗 → false
      onOk: () => finish(true),
      onCancel: () => finish(false),
    });
  });

export default function Backdoor() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  // 「清除数据」请求进行中：按钮转圈 + 禁用，防连点重复提交
  const [clearing, setClearing] = useState(false);
  // 第 3 次确认 = 口令弹窗：open 控制显隐，ref 存 Promise 的 resolve，
  // 这样弹窗关闭时能把「用户填的口令 / null(取消)」交回 await 的地方继续往下走
  const [clearPwdOpen, setClearPwdOpen] = useState(false);
  const [clearPwd, setClearPwd] = useState('');
  const clearPwdResolveRef = useRef(null);

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

  // 第 3 次确认：弹出「输入清除口令」弹窗，返回 Promise<string | null>
  //   点「确定，立即清除」且口令非空 → resolve(用户输入的口令)
  //   点「取消」/ 叉掉弹窗 / 按 ESC → resolve(null)，调用方据此立刻终止
  //   ⚠️ 前端**不判断**口令对不对、也不保存任何口令副本，只把输入原样交给后端比对
  const askClearPassword = () =>
    new Promise((resolve) => {
      clearPwdResolveRef.current = resolve;
      setClearPwd(''); // 每次打开都清空上一次的残留输入
      setClearPwdOpen(true);
    });

  // 口令弹窗的两个出口：带值关闭 = 放行；带 null 关闭 = 取消
  const finishClearPassword = (value) => {
    setClearPwdOpen(false);
    const resolve = clearPwdResolveRef.current;
    clearPwdResolveRef.current = null;
    if (resolve) resolve(value);
  };

  // 「清除数据」：第 1、2 次是普通确认弹窗，第 3 次必须输入清除口令；
  //   任意一次点「取消」或叉掉弹窗 → 立刻 return，一个字节都不发给后端。
  //   （真正的边界在后端：requireSystemAdmin 只认 admin_type=9 + 校验口令哈希）
  const handleClearData = async () => {
    for (let step = 1; step <= 2; step += 1) {
      const confirmed = await askClearConfirm(step);
      if (!confirmed) {
        message.info(`已取消清除（第 ${step} / 3 次确认未通过）`);
        return;
      }
    }
    // 第 3 次：输入清除口令
    const password = await askClearPassword();
    if (!password) {
      message.info('已取消清除（第 3 / 3 次确认未通过）');
      return;
    }
    setClearing(true);
    try {
      const res = await clearAllData(password);
      if (res?.code === 'OK') {
        const removed = res?.data?.cleared?.user_table ?? 0;
        message.success(`已清除全部业务数据（共删除 ${removed} 个员工账号）`);
        await reload(); // 刷新员工 / 审核关系列表
      } else {
        message.error(res?.message || '清除失败');
      }
    } catch (e) {
      message.error(e?.message || '清除失败');
    } finally {
      setClearing(false);
      setClearPwd(''); // 口令用完立刻从内存抹掉，不留副本
    }
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
            <Tag color="geekblue">仅系统管理员可见</Tag>
          </Space>
          <Space>
            <Text type="secondary">
              {user.name}（{user.work_id}）
            </Text>
            {/* 清除数据：危险操作，点击后要连过 3 次确认（详见 handleClearData） */}
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={clearing}
              onClick={handleClearData}
            >
              清除数据
            </Button>
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
              key: 'form-override',
              label: (
                <span>
                  <ProfileOutlined />
                  个人问卷维护
                </span>
              ),
              // 给个别员工单独定制履职贡献问卷（改题干 / 改选项 / 改分值 / 增删题 / 调序）
              // 保存即写库生效，不需要重新打包部署
              children: <FormOverridePanel />,
            },
            {
              key: 'permissions',
              label: (
                <span>
                  <SafetyCertificateOutlined />
                  权限管理
                </span>
              ),
              // 把上面这些系统维护功能开放给指定账号 / 从指定账号收回
              // 数据落在 permission 表，只有系统管理员能进这个 Tab
              children: <PermissionTab />,
            },
            {
              key: 'placeholder-4',
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

        {/* 第 3 次确认：输入清除口令（前两次走 Modal.confirm，见 askClearConfirm） */}
        <Modal
          open={clearPwdOpen}
          title="清除数据 · 第 3 / 3 次确认（需输入清除口令）"
          okText="确定，立即清除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          // 关闭动画结束后清空输入，口令不在组件状态里留副本
          afterClose={() => setClearPwd('')}
          // 遮罩点击不关闭：避免打字时误点遮罩把三次确认全白做了
          // （右上角叉号 / 「取消」按钮 / ESC 仍然照常终止）
          maskClosable={false}
          onOk={() => {
            // 空口令不放行、也不关弹窗 —— 杜绝"什么都不输就清了"
            if (!clearPwd) {
              message.error('请输入清除口令');
              return;
            }
            finishClearPassword(clearPwd);
          }}
          // 点「取消」/ 叉掉弹窗 / 按 ESC → null，整个流程立刻终止
          onCancel={() => finishClearPassword(null)}
        >
          <Alert
            type="error"
            showIcon
            message="最后一步：请输入清除口令"
            description="口令正确才会执行清空。此操作不可撤销、不可恢复，只会保留你当前的超级管理员账号。"
            style={{ marginBottom: 12 }}
          />
          <Input.Password
            autoFocus
            placeholder="请输入清除口令"
            value={clearPwd}
            onChange={(e) => setClearPwd(e.target.value)}
            onPressEnter={() => {
              if (!clearPwd) {
                message.error('请输入清除口令');
                return;
              }
              finishClearPassword(clearPwd);
            }}
          />
        </Modal>
      </div>
    </div>
  );
}
