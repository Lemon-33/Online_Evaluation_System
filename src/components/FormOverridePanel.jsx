import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  ADMIN_TYPE_META,
  ADMIN_TYPE_SYSTEM,
  POSITION_FORMS,
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  getPositionForm,
} from '../lib/constants';
import {
  deleteFormOverride,
  getFormOverride,
  listFormOverrideMembers,
  saveFormOverride,
} from '../lib/cloudbase';

// ============================================================
// 个人问卷维护面板（只挂在系统管理员页 /backdoor 里）
// ------------------------------------------------------------
// 给某个员工单独定制一份「履职贡献」卷子：改题干 / 改选项 / 改分值 / 删题 / 加题 / 调序。
//
// 数据流：写库（form_override 表），保存即生效，不需要重新打包部署。
// 生效优先级（见 constants.resolveFormDef）：
//   ① 已审核记录的历史快照 snapshot（最高，永不改）
//   ② 本面板保存的个人问卷（work_id 命中 且 position 与员工当前岗位一致）
//   ③ forms-data.mjs 的 USER_FORM_OVERRIDES（代码兜底）
//   ④ 14 套岗位基础模板
//
// 重要约束：
//   - 只影响「未提交 / 未审核」的记录；已审核记录永远按当时题干回显
//   - 换岗后（position 对不上）个人问卷自动失效，需重新保存
//   - 「履职扣分」是系统保留章节名（员工页隐藏、审核页专用），改名/删除会导致
//     审核人无法录入扣分 —— 面板对此有显式告警
// ============================================================

const cloneJson = (v) => JSON.parse(JSON.stringify(v));

// 该章节名在代码里被特判，改名会破坏「员工看不到扣分段 / 审核页专录扣分」的逻辑
const DEDUCT_SECTION_TITLE = '履职扣分';

// 常用单位（填空题）
const UNIT_OPTIONS = ['项', '次', '件', '人次', '张', '起', '天', '人', '个', '份'].map(
  (v) => ({ value: v })
);

// 与后端 sanitizeFormDef 对齐的前端校验：返回错误文案（'' = 通过）
function validateSections(secs) {
  if (!secs?.length) return '整份问卷至少要保留 1 个章节';
  const keys = new Set();
  let count = 0;
  for (const sec of secs) {
    const title = String(sec?.title ?? '').trim();
    if (!title) return '章节名称不能为空';
    if (!sec.items?.length) return `章节「${title}」里已经没有题目了，请删除该章节`;
    for (const it of sec.items) {
      const key = String(it?.key ?? '').trim();
      if (!key) return `章节「${title}」中有题目缺少题号`;
      if (keys.has(key)) return `题号「${key}」在整个问卷中重复`;
      keys.add(key);
      if (!String(it.label ?? '').trim()) return `题目「${key}」的题干不能为空`;
      if (it.type === 'fill') {
        if (!Number.isFinite(Number(it.unitScore)))
          return `题目「${key}」的单次分值必须是数字`;
      } else if (!it.options?.length) {
        return `选择题「${key}」至少需要 1 个选项`;
      }
      count += 1;
    }
  }
  if (!count) return '整份问卷至少要保留 1 道题';
  return '';
}

export default function FormOverridePanel() {
  // ---- 员工名单 ----
  const [members, setMembers] = useState([]);
  const [customized, setCustomized] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // ---- 单框定位：姓名或工号（与「权限管理」页同一套交互）----
  const [keyword, setKeyword] = useState('');

  // ---- 当前已调出的员工与问卷 ----
  const [member, setMember] = useState(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rec, setRec] = useState(null); // 库里已有的个人问卷记录（null = 未定制）
  const [sections, setSections] = useState(null); // 编辑区
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  // 库里记录的 position 与员工当前岗位不一致（换岗后没重新保存）
  const [positionStale, setPositionStale] = useState(false);

  // ---- 题目编辑弹窗 / 预览弹窗 ----
  const [itemModal, setItemModal] = useState({ open: false, si: -1, ii: -1 });
  const [previewOpen, setPreviewOpen] = useState(false);

  // 岗位基础模板（无 → 该岗位在 forms-data.mjs 里没有配置）
  const baseSections = useMemo(
    () => (member?.position ? POSITION_FORMS[member.position]?.sections || null : null),
    [member]
  );

  const totalItems = useMemo(
    () => (sections || []).reduce((n, s) => n + (s.items?.length || 0), 0),
    [sections]
  );

  // 单框下拉：value 一律用工号（选中即唯一确定），label 带姓名 / 岗位 / 是否已定制，
  //   同名的人在 label 里用工号区分。输入框直接敲姓名或工号都能联想（见 filterOption）
  const memberOptions = useMemo(
    () =>
      members
        .filter((m) => m.work_id)
        .map((m) => ({
          value: m.work_id,
          label: `${m.work_id}　${m.name}　${
            m.position ? findPositionLabel(m.position) : '岗位未填写'
          }${customized.includes(m.work_id) ? '　[已定制]' : ''}`,
        })),
    [members, customized]
  );

  // ---------- 名单加载 ----------
  const loadMembers = async (silent) => {
    setLoadingMembers(true);
    try {
      const { list, customized: cus } = await listFormOverrideMembers();
      // 排除系统管理员：本页所有选人入口（姓名下拉 / 工号下拉 / 手动输入后点「调出」）
      // 都基于这一份名单做匹配 —— 从源头剔除，等于手动输入它的姓名或工号也命中不了。
      // 后端 /api/form-overrides/members 已排除，这里是第二层。
      // 注意字段名：本接口后端已把 admin_type 映射成 adminType
      // （见 server.js /api/form-overrides/members 的 rows.map）。
      // 这里必须写 adminType —— 写成 admin_type 会恒为 undefined，
      // 而 undefined !== 9 永远成立，等于该条件失效，只剩 work_id 那条在起作用。
      const visible = (list || []).filter(
        (m) =>
          m.work_id !== 'superadmin' && m.adminType !== ADMIN_TYPE_SYSTEM,
      );
      setMembers(visible);
      setCustomized(cus || []);
      if (!silent) message.success(`已刷新名单：${visible.length} 名员工`);
    } catch (e) {
      message.error(e?.message || '加载员工名单失败');
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    loadMembers(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 调出某人的问卷 ----------
  const loadMember = async (m) => {
    if (dirty && !window.confirm('当前修改尚未保存，确定切换到其他员工吗？')) return;
    setMember(m);
    setKeyword(m.work_id);
    setLoadingForm(true);
    try {
      const r = await getFormOverride(m.work_id);
      setRec(r);
      const stale = !!(r && m.position && r.position !== m.position);
      setPositionStale(stale);
      // 起点 = 该员工「当前实际生效的问卷」：
      //   库里已定制且岗位匹配 → 用库里那份；否则 → 基础模板 + 代码版覆盖
      const seed =
        r?.formDef?.sections?.length && !stale
          ? r.formDef
          : getPositionForm(m.position, m.work_id);
      setSections(cloneJson(seed?.sections || []));
      setNote(r?.note || '');
      setDirty(false);
    } catch (e) {
      message.error(e?.message || '加载个人问卷失败');
      setSections([]);
      setRec(null);
    } finally {
      setLoadingForm(false);
    }
  };

  // 把「姓名或工号」单框解析成唯一员工：先按工号精确匹配，再按姓名匹配
  const resolveMember = () => {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return { error: '请先选择（或直接输入）姓名 / 工号' };
    const byId = members.find((m) => String(m.work_id || '').toLowerCase() === q);
    if (byId) return { member: byId };
    const byName = members.filter((m) => String(m.name || '').toLowerCase() === q);
    if (byName.length === 1) return { member: byName[0] };
    if (byName.length > 1)
      return {
        error: `姓名「${String(keyword).trim()}」对应 ${byName.length} 个工号，请从下拉里选具体工号`,
      };
    return { error: `「${String(keyword).trim()}」不在已注册用户里` };
  };

  const onLoad = () => {
    const r = resolveMember();
    if (r.error) {
      message.warning(r.error);
      return;
    }
    loadMember(r.member);
  };

  // 从下拉里点选：value 就是工号，唯一确定 → 直接调出
  const onPick = (v) => {
    setKeyword(v || '');
    const hit = members.find((m) => m.work_id === v);
    if (hit) loadMember(hit);
  };

  // ---------- 编辑操作 ----------
  const moveItem = (si, ii, dir) => {
    setSections((prev) =>
      prev.map((sec, a) => {
        if (a !== si) return sec;
        const items = [...sec.items];
        const j = ii + dir;
        if (j < 0 || j >= items.length) return sec;
        [items[ii], items[j]] = [items[j], items[ii]];
        return { ...sec, items };
      })
    );
    setDirty(true);
  };

  const removeItem = (si, ii) => {
    setSections((prev) =>
      prev.map((sec, a) =>
        a === si ? { ...sec, items: sec.items.filter((_, j) => j !== ii) } : sec
      )
    );
    setDirty(true);
  };

  const applyItem = (item) => {
    setSections((prev) =>
      prev.map((sec, a) => {
        if (a !== itemModal.si) return sec;
        const items = [...sec.items];
        if (itemModal.ii >= 0) items[itemModal.ii] = item;
        else items.push(item);
        return { ...sec, items };
      })
    );
    setDirty(true);
    setItemModal({ open: false, si: -1, ii: -1 });
  };

  const renameSection = (si, title) => {
    setSections((prev) => prev.map((sec, a) => (a === si ? { ...sec, title } : sec)));
    setDirty(true);
  };

  const moveSection = (si, dir) => {
    setSections((prev) => {
      const j = si + dir;
      if (j < 0 || j >= prev.length) return prev;
      const out = [...prev];
      [out[si], out[j]] = [out[j], out[si]];
      return out;
    });
    setDirty(true);
  };

  const removeSection = (si) => {
    setSections((prev) => prev.filter((_, a) => a !== si));
    setDirty(true);
  };

  const addSection = () => {
    setSections((prev) => [...(prev || []), { title: '新章节', items: [] }]);
    setDirty(true);
  };

  // 用基础模板重置编辑区（仅本地，要生效仍需点保存）
  const reloadBase = () => {
    if (!member) return;
    const base = getPositionForm(member.position, member.work_id);
    if (!base) {
      message.warning('该岗位没有基础模板，无法重置');
      return;
    }
    if (!window.confirm('确定用基础模板覆盖当前编辑区内容吗？（尚未保存，可再手动修改）'))
      return;
    setSections(cloneJson(base.sections));
    setNote('');
    setDirty(true);
  };

  // ---------- 保存 ----------
  const onSave = async () => {
    if (!member) return;
    if (!member.position) {
      message.error('该员工未填写岗位，无法保存个人问卷');
      return;
    }
    const err = validateSections(sections);
    if (err) {
      message.error(err);
      return;
    }
    setSaving(true);
    try {
      await saveFormOverride(member.work_id, {
        position: member.position,
        formDef: { sections },
        note,
      });
      setDirty(false);
      setPositionStale(false);
      setRec({
        work_id: member.work_id,
        position: member.position,
        formDef: { sections },
        note,
      });
      setCustomized((c) =>
        c.includes(member.work_id) ? c : [...c, member.work_id]
      );
      message.success('已保存，该员工下次进入自评页即按这份问卷渲染');
    } catch (e) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ---------- 删除个人问卷（恢复默认） ----------
  const onResetDefault = async () => {
    if (!member) return;
    try {
      await deleteFormOverride(member.work_id);
      setRec(null);
      setPositionStale(false);
      setCustomized((c) => c.filter((x) => x !== member.work_id));
      const base = getPositionForm(member.position, member.work_id);
      setSections(cloneJson(base?.sections || []));
      setNote('');
      setDirty(false);
      message.success('已删除个人问卷，该员工回到岗位基础模板');
    } catch (e) {
      message.error(e?.message || '恢复默认失败');
    }
  };

  // 全部已用题号（弹窗内查重用）；排除正在编辑的那一道
  const usedKeys = useMemo(() => {
    const { si, ii } = itemModal;
    const s = new Set();
    (sections || []).forEach((sec, a) =>
      (sec.items || []).forEach((it, b) => {
        if (a === si && b === ii) return;
        s.add(it.key);
      })
    );
    return s;
  }, [itemModal, sections]);

  // 弹窗初始值：编辑现有题 → 该题；新增 → 一个选择题空壳
  const itemModalInitial = useMemo(() => {
    const { si, ii } = itemModal;
    if (si < 0 || !sections) return null;
    if (ii >= 0) return cloneJson(sections[si].items[ii]);
    return {
      key: '',
      label: '',
      type: 'choice',
      options: [
        { value: 'yes', label: '满足', score: 0 },
        { value: 'no', label: '不满足', score: 0 },
      ],
    };
  }, [itemModal, sections]);

  const noDeductSection =
    !!sections && sections.length > 0 && !sections.some((s) => s.title === DEDUCT_SECTION_TITLE);

  return (
    <>
      <Alert
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        style={{ marginBottom: 16 }}
        message="个人问卷只影响「未提交 / 未审核」的记录"
        description={
          <>
            已审核的历史记录永远按当时的题干（快照）回显，不受此处改动影响。
            若该员工<strong>本月已提交自评但尚未审核</strong>，请让他重新提交一次以套用新问卷；
            否则他看到的题目与已存答案可能对不上。换岗后个人问卷会自动失效，需要重新保存。
          </>
        }
      />

      {/* ===== 选择员工：单个框，姓名或工号都能定位（也可直接键盘输入） ===== */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 4 }}>
              <Typography.Text strong>选择员工</Typography.Text>
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                可下拉选择，也可直接输入姓名或工号联想；同名的人从下拉里按工号区分
              </Typography.Text>
            </div>
            <Space wrap size={12}>
              <AutoComplete
                style={{ width: 360 }}
                value={keyword}
                options={memberOptions}
                onChange={(v) => setKeyword(v || '')}
                onSelect={onPick}
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
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={onLoad}
                loading={loadingForm}
              >
                调出问卷
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadMembers(false)}
                loading={loadingMembers}
              >
                刷新名单
              </Button>
            </Space>
          </div>

          {member && (
            <Space wrap size={8}>
              {/* 人名统一黑色显示 */}
              <Tag color="default" style={{ color: '#000' }}>
                {member.name}
              </Tag>
              <Tag>{member.work_id}</Tag>
              <Tag color="geekblue">
                {member.position ? findPositionLabel(member.position) : '岗位未填写'}
              </Tag>
              {member.positionType && (
                <Tag>{findLabel(POSITION_TYPES, member.positionType)}</Tag>
              )}
              {member.adminType != null && ADMIN_TYPE_META[member.adminType] && (
                <Tag color={ADMIN_TYPE_META[member.adminType].color}>
                  {ADMIN_TYPE_META[member.adminType].text}
                </Tag>
              )}
              {rec && (
                <Tag color="orange">
                  已定制
                  {rec.updatedAt ? ` · ${rec.updatedAt}` : ''}
                  {rec.updatedBy ? ` · by ${rec.updatedBy}` : ''}
                </Tag>
              )}
              {dirty && <Tag color="red">有未保存的修改</Tag>}
            </Space>
          )}
        </Space>
      </Card>

      {!member && (
        <Empty
          style={{ marginTop: 32 }}
          description="请先选择一名员工并点「调出问卷」，即可定制他的履职贡献问卷"
        />
      )}

      {member && loadingForm && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin tip="加载中…" />
        </div>
      )}

      {member && !loadingForm && (
        <>
          {!member.position && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="该员工没有填写岗位，无法生成问卷"
              description="编辑需要以岗位基础模板为起点。请先在「员工信息维护」里把他的岗位（岗位类型 + 岗位）补齐。"
            />
          )}

          {member.position && !baseSections && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={`岗位「${member.position}」在 forms-data.mjs 里没有对应的基础模板`}
              description="请确认该员工的岗位 key 是否正确（应为 14 套模板之一）。"
            />
          )}

          {positionStale && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该员工已换岗，之前的个人问卷已自动失效"
              description={`库里记录生成时岗位为「${rec?.position}」，与当前岗位「${member.position}」不一致，因此当前渲染回落基础模板。编辑区已按当前岗位重新载入，保存后即恢复生效。`}
            />
          )}

          {noDeductSection && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={`缺少「${DEDUCT_SECTION_TITLE}」章节`}
              description={`「${DEDUCT_SECTION_TITLE}」是系统保留章节名：员工自评页会隐藏它，审核页专用它录入扣分。删除或改名后，审核人将无法录入履职扣分，总分也无法扣减。`}
            />
          )}

          {member.position && baseSections && sections && (
            <>
              <Space wrap style={{ marginBottom: 12 }}>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!dirty}
                  onClick={onSave}
                >
                  保存
                </Button>
                <Button icon={<UndoOutlined />} onClick={reloadBase}>
                  用基础模板重置编辑区
                </Button>
                <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
                  预览
                </Button>
                {rec && (
                  <Popconfirm
                    title="删除该员工的个人问卷？"
                    description="删除后他将回到岗位基础模板。已审核的历史记录不受影响。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={onResetDefault}
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      删除个人问卷（恢复默认）
                    </Button>
                  </Popconfirm>
                )}
                <Typography.Text type="secondary">
                  共 {sections.length} 个章节 / {totalItems} 道题
                </Typography.Text>
              </Space>

              <div style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary">
                  备注（为什么给他单独定制，方便日后追溯）：
                </Typography.Text>
                <Input
                  value={note}
                  maxLength={200}
                  showCount
                  placeholder="例：兼管工会台账，减掉与本职无关的两道题"
                  onChange={(e) => {
                    setNote(e.target.value);
                    setDirty(true);
                  }}
                  style={{ marginTop: 6 }}
                />
              </div>

              {sections.map((sec, si) => {
                const isDeduct = sec.title === DEDUCT_SECTION_TITLE;
                return (
                  <Card
                    key={`sec-${si}`}
                    size="small"
                    style={{
                      marginBottom: 12,
                      borderColor: isDeduct ? '#ffa39e' : undefined,
                    }}
                    title={
                      <Space wrap size={8}>
                        <Input
                          value={sec.title}
                          onChange={(e) => renameSection(si, e.target.value)}
                          style={{ width: 240 }}
                        />
                        {isDeduct && (
                          <Tooltip title="系统保留章节名：员工自评页隐藏它，审核页专用它录入扣分，请勿改名或删除">
                            <Tag color="red" icon={<InfoCircleOutlined />}>
                              系统保留名
                            </Tag>
                          </Tooltip>
                        )}
                        <Tag>{sec.items.length} 题</Tag>
                      </Space>
                    }
                    extra={
                      <Space size={4}>
                        <Tooltip title="章节上移">
                          <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            disabled={si === 0}
                            onClick={() => moveSection(si, -1)}
                          />
                        </Tooltip>
                        <Tooltip title="章节下移">
                          <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            disabled={si === sections.length - 1}
                            onClick={() => moveSection(si, 1)}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="删除整个章节？"
                          description="章节里的所有题目会一起删除"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => removeSection(si)}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    }
                  >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      {sec.items.map((it, ii) => (
                        <div
                          key={`${it.key}-${ii}`}
                          style={{
                            display: 'flex',
                            gap: 12,
                            alignItems: 'flex-start',
                            padding: '8px 12px',
                            background: '#fafafa',
                            border: '1px solid #f0f0f0',
                            borderRadius: 6,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Space size={6} wrap style={{ marginBottom: 4 }}>
                              <Tag color={it.type === 'fill' ? 'geekblue' : 'green'}>
                                {it.type === 'fill' ? '填空' : '选择'}
                              </Tag>
                              <Tag>{it.key}</Tag>
                              {it.type === 'fill' ? (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  每{it.unit || '项'} {it.unitScore > 0 ? '+' : ''}
                                  {it.unitScore} 分
                                  {it.hasReason !== false ? ' · 需填原因' : ' · 不填原因'}
                                </Typography.Text>
                              ) : (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {(it.options || [])
                                    .map((o) => `${o.label} ${o.score}`)
                                    .join(' / ')}
                                </Typography.Text>
                              )}
                            </Space>
                            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {it.label}
                            </div>
                          </div>
                          <Space size={4}>
                            <Tooltip title="上移">
                              <Button
                                size="small"
                                icon={<ArrowUpOutlined />}
                                disabled={ii === 0}
                                onClick={() => moveItem(si, ii, -1)}
                              />
                            </Tooltip>
                            <Tooltip title="下移">
                              <Button
                                size="small"
                                icon={<ArrowDownOutlined />}
                                disabled={ii === sec.items.length - 1}
                                onClick={() => moveItem(si, ii, 1)}
                              />
                            </Tooltip>
                            <Button
                              size="small"
                              type="link"
                              icon={<EditOutlined />}
                              onClick={() => setItemModal({ open: true, si, ii })}
                            >
                              编辑
                            </Button>
                            <Popconfirm
                              title="删除这道题？"
                              description="若该员工已填过这道题，对应答案会一并作废"
                              okText="删除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => removeItem(si, ii)}
                            >
                              <Button
                                size="small"
                                type="link"
                                danger
                                icon={<DeleteOutlined />}
                              >
                                删除
                              </Button>
                            </Popconfirm>
                          </Space>
                        </div>
                      ))}
                      <Button
                        block
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => setItemModal({ open: true, si, ii: -1 })}
                      >
                        在「{sec.title}」末尾添加题目
                      </Button>
                    </Space>
                  </Card>
                );
              })}

              <Button block type="dashed" icon={<PlusOutlined />} onClick={addSection}>
                新增章节
              </Button>
            </>
          )}
        </>
      )}

      <ItemEditorModal
        open={itemModal.open}
        isNew={itemModal.ii < 0}
        initial={itemModalInitial}
        usedKeys={usedKeys}
        onCancel={() => setItemModal({ open: false, si: -1, ii: -1 })}
        onSubmit={applyItem}
      />

      <Modal
        open={previewOpen}
        title="预览：该员工将看到的问卷"
        width={860}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
      >
        {(sections || []).map((sec, si) => (
          <Card key={`pv-${si}`} size="small" title={sec.title} style={{ marginBottom: 12 }}>
            {sec.items.map((it, ii) => (
              <div key={`pv-${si}-${ii}`} style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 4 }}>
                  <Tag color={it.type === 'fill' ? 'geekblue' : 'green'}>
                    {it.type === 'fill' ? '填空' : '选择'}
                  </Tag>
                  {it.label}
                </div>
                {it.type === 'fill' ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    数量 × {it.unitScore} 分 / {it.unit || '项'}
                  </Typography.Text>
                ) : (
                  <Space wrap size={6}>
                    {(it.options || []).map((o) => (
                      <Tag key={o.value}>
                        {o.label}（{o.score > 0 ? '+' : ''}
                        {o.score} 分）
                      </Tag>
                    ))}
                  </Space>
                )}
              </div>
            ))}
          </Card>
        ))}
      </Modal>
    </>
  );
}

// ============================================================
// 单道题的编辑弹窗（新增 / 修改）
// ------------------------------------------------------------
// 用本地 state 管草稿（不用 antd Form）：选择题的 options 是动态数组，
// 本地 state 更直观，也更好做跨字段校验。
// ============================================================
function ItemEditorModal({ open, isNew, initial, usedKeys, onCancel, onSubmit }) {
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open && initial) {
      setDraft(cloneJson(initial));
      setErr('');
    }
  }, [open, initial]);

  if (!open || !draft) return null;

  const isFill = draft.type === 'fill';
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  const options = draft.options || [];
  const setOpt = (i, p) =>
    patch({ options: options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const addOpt = () =>
    patch({
      options: [...options, { value: `opt${options.length + 1}`, label: '', score: 0 }],
    });
  const delOpt = (i) => patch({ options: options.filter((_, j) => j !== i) });

  const submit = () => {
    const key = String(draft.key || '').trim();
    const label = String(draft.label || '').trim();

    if (!key) return setErr('请填写题号（key），用于唯一标识这道题');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key))
      return setErr('题号只能由字母 / 数字 / 下划线 / 连字符组成，且不超过 64 位');
    if (!isNew && key !== initial.key)
      return setErr('已存在的题号不可修改（改了会导致员工已填的答案对不上）');
    if (usedKeys.has(key)) return setErr(`题号「${key}」已被本问卷其它题目占用`);
    if (!label) return setErr('请填写题干');
    if (label.length > 500) return setErr('题干最多 500 字');

    if (isFill) {
      const unitScore = Number(draft.unitScore);
      if (!Number.isFinite(unitScore))
        return setErr('单次分值必须是数字（扣分题填负数）');
      return onSubmit({
        key,
        type: 'fill',
        label,
        unitScore,
        unit: String(draft.unit || '项').trim() || '项',
        hasReason: draft.hasReason !== false,
      });
    }

    const opts = options
      .map((o) => ({
        value: String(o.value ?? '').trim(),
        label: String(o.label ?? '').trim(),
        score: Number(o.score) || 0,
      }))
      .filter((o) => o.value);
    if (!opts.length) return setErr('选择题至少需要 1 个选项（且选项值不能为空）');
    if (new Set(opts.map((o) => o.value)).size !== opts.length)
      return setErr('选项值重复，每个选项的 value 必须唯一');
    return onSubmit({ key, label, options: opts });
  };

  return (
    <Modal
      open={open}
      title={isNew ? '新增题目' : `修改题目（${initial?.key}）`}
      width={720}
      okText="确定"
      cancelText="取消"
      onCancel={onCancel}
      onOk={submit}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {err && <Alert type="error" showIcon message={err} />}

        <div>
          <div style={{ marginBottom: 4 }}>题号（key，唯一标识，保存后不可改）</div>
          <Input
            value={draft.key}
            disabled={!isNew}
            placeholder="例：custom_fill_1"
            onChange={(e) => patch({ key: e.target.value })}
          />
        </div>

        <div>
          <div style={{ marginBottom: 4 }}>题型</div>
          <Radio.Group
            value={draft.type === 'fill' ? 'fill' : 'choice'}
            onChange={(e) => {
              const t = e.target.value;
              if (t === 'fill') {
                setDraft((d) => ({
                  ...d,
                  type: 'fill',
                  unitScore: d.unitScore ?? 5,
                  unit: d.unit || '项',
                  hasReason: d.hasReason !== false,
                }));
              } else {
                setDraft((d) => ({
                  key: d.key,
                  label: d.label,
                  options: d.options?.length
                    ? d.options
                    : [
                        { value: 'yes', label: '满足', score: 0 },
                        { value: 'no', label: '不满足', score: 0 },
                      ],
                }));
              }
            }}
          >
            <Radio value="fill">填空题（填数量，按数量 × 单次分值计分）</Radio>
            <Radio value="choice">选择题（选一个选项得分）</Radio>
          </Radio.Group>
        </div>

        <div>
          <div style={{ marginBottom: 4 }}>题干（最多 500 字）</div>
          <Input.TextArea
            value={draft.label}
            autoSize={{ minRows: 2, maxRows: 6 }}
            maxLength={500}
            showCount
            onChange={(e) => patch({ label: e.target.value })}
          />
        </div>

        {isFill ? (
          <>
            <Space size={16} wrap>
              <div>
                <div style={{ marginBottom: 4 }}>单次分值（扣分题填负数）</div>
                <InputNumber
                  style={{ width: 160 }}
                  value={draft.unitScore}
                  onChange={(v) => patch({ unitScore: v })}
                />
              </div>
              <div>
                <div style={{ marginBottom: 4 }}>单位</div>
                <AutoComplete
                  style={{ width: 140 }}
                  value={draft.unit}
                  options={UNIT_OPTIONS}
                  onChange={(v) => patch({ unit: v })}
                  placeholder="项 / 次 / 件…"
                />
              </div>
            </Space>
            <div>
              <Space>
                <Switch
                  checked={draft.hasReason !== false}
                  onChange={(v) => patch({ hasReason: v })}
                />
                <span>要求员工填写「原因」说明（审核页会作为只读字段展示）</span>
              </Space>
            </div>
          </>
        ) : (
          <div>
            <div style={{ marginBottom: 4 }}>选项（value 唯一，score 可为 0）</div>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {options.map((o, i) => (
                <Space key={i} size={8} style={{ width: '100%' }} align="baseline">
                  <Input
                    style={{ width: 120 }}
                    value={o.value}
                    placeholder="value"
                    onChange={(e) => setOpt(i, { value: e.target.value })}
                  />
                  <Input
                    style={{ width: 260 }}
                    value={o.label}
                    placeholder="显示文案，如 满足"
                    onChange={(e) => setOpt(i, { label: e.target.value })}
                  />
                  <InputNumber
                    style={{ width: 110 }}
                    value={o.score}
                    placeholder="得分"
                    onChange={(v) => setOpt(i, { score: v })}
                  />
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    disabled={options.length <= 1}
                    onClick={() => delOpt(i)}
                  />
                </Space>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={addOpt}>
                添加选项
              </Button>
            </Space>
          </div>
        )}
      </Space>
    </Modal>
  );
}
