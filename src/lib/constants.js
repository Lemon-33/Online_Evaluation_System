// 评分维度（统一配置：自评 / 审核 / 导出 共用）
export const SCORE_DIMENSIONS = [
  { key: 'politicalQuality', label: '政治素质', max: 20, desc: '政治立场坚定，理想信念牢固' },
  { key: 'workPerformance', label: '工作业绩', max: 25, desc: '履职尽责，工作质量与效率' },
  { key: 'massContact', label: '联系群众', max: 15, desc: '服务群众、解决群众困难' },
  { key: 'disciplineCompliance', label: '纪律作风', max: 20, desc: '廉洁自律，遵守党纪党规' },
  { key: 'innovation', label: '先锋模范', max: 20, desc: '敢于担当、勇于创新、表率作用' },
];

// 计算总分（满分 100）
export const calcTotal = (scores = {}) =>
  SCORE_DIMENSIONS.reduce((sum, d) => sum + Number(scores[d.key] || 0), 0);

// 评价等级
export const calcGrade = (total) => {
  if (total >= 90) return '优秀';
  if (total >= 75) return '良好';
  if (total >= 60) return '合格';
  return '不合格';
};

// ===== 用户角色 =====
// 员工 = 普通党员，参与自评
// 管理员 = 支部负责人，可审核 / 导出
export const ROLES = {
  EMPLOYEE: 'employee',
  ADMIN: 'admin',
};

// ===== 身份类型（admin_type，所有人都有；不再有"管理员 / 员工"二分）=====
//   0 = 分管领导   只审核履职贡献、不自评；岗位类型可留空
//   1 = 组织委员   履职贡献自评 + 基础积分评价；必须填岗位类型
//   2 = 支部书记   履职贡献审核 + 基础积分评价（范围全体）；岗位类型可留空
//   3 = 普通党员   履职贡献自评 + 只读查看；必须填岗位类型
// 取自 user_table.admin_type 字段；注册时由工号白名单决定
export const ADMIN_TYPE_LEADER = 0;
export const ADMIN_TYPE_ORGANIZER = 1;
export const ADMIN_TYPE_SECRETARY = 2;
export const ADMIN_TYPE_EMPLOYEE = 3;
// 后门 / 系统管理员：仅用于 /backdoor 维护工具，不在白名单、不参与业务范围
export const ADMIN_TYPE_SYSTEM = 9;

// 兼容旧引用：ADMIN_TYPE_SUPER 即支部书记
export const ADMIN_TYPE_SUPER = ADMIN_TYPE_SECRETARY;

export const ADMIN_TYPE_META = {
  [ADMIN_TYPE_LEADER]:    { text: '分管领导',   color: 'gold' },
  [ADMIN_TYPE_ORGANIZER]: { text: '组织委员',   color: 'purple' },
  [ADMIN_TYPE_SECRETARY]: { text: '支部书记',   color: 'magenta' },
  [ADMIN_TYPE_EMPLOYEE]:  { text: '普通党员',   color: 'blue' },
  [ADMIN_TYPE_SYSTEM]:    { text: '系统管理员', color: 'red' },
};

// 可提交「履职贡献自评」的身份：普通党员(3) + 组织委员(1)
export const canSelfEval = (u) =>
  !!u && (u.adminType === ADMIN_TYPE_ORGANIZER || u.adminType === ADMIN_TYPE_EMPLOYEE);

// 登录后默认落地页（各身份的工作台首屏）
export const homePath = (u) => {
  const at = u?.adminType;
  if (at === ADMIN_TYPE_SYSTEM) return '/backdoor';     // 系统管理员：维护工具
  if (at === ADMIN_TYPE_LEADER) return '/review';       // 分管领导：履职积分审核
  if (at === ADMIN_TYPE_SECRETARY) return '/review';    // 支部书记：审核（可切基础积分评价）
  if (at === ADMIN_TYPE_ORGANIZER) return '/basic-rating';
  return '/self';                                        // 普通党员：自评
};

export const ROLE_META = {
  [ROLES.EMPLOYEE]: { text: '员工（党员）', color: 'blue' },
  [ROLES.ADMIN]: { text: '管理员（支部）', color: 'red' },
};

// ===== 所在党支部（员工 / 管理员注册时均需选择） =====
export const BRANCHES = [
  { value: 'first', label: '第一党支部' },
  { value: 'second', label: '第二党支部' },
];

// ===== 员工专属字段 =====
// 岗位类型（三个类别，决定「岗位」下拉的可选项）
export const POSITION_TYPES = [
  { value: 'professional', label: '专业技术岗位党员' },
  { value: 'teamLeader', label: '班组长岗位党员' },
  { value: 'teamMember', label: '班组成员岗位党员' },
];

// 岗位（按岗位类型分组，注册时根据所选类型动态展示）
export const POSITIONS_BY_TYPE = {
  // 专业技术岗位党员
  professional: [
    { value: 'distributionTech', label: '配网专业技术岗' },
    { value: 'marketingTech', label: '营销专业技术岗' },
    { value: 'engineeringTech', label: '工程专业技术岗' },
    { value: 'generalAffairs', label: '综合事务岗' },
  ],
  // 班组长岗位党员
  teamLeader: [
    { value: 'businessTeamLeader', label: '营业班班长' },
    { value: 'keyAccountTeamLeader', label: '大客户班班长' },
    { value: 'lvIntegratedTeamLeader', label: '低压综合服务班班长' },
    { value: 'distributionOperationTeamLeader', label: '配电运检班班长' },
    { value: 'distributionEngineeringTeamLeader', label: '配电工程班班长' },
  ],
  // 班组成员岗位党员
  teamMember: [
    { value: 'businessTeamMember', label: '营业班班组成员' },
    { value: 'keyAccountTeamMember', label: '大客户班班组成员' },
    { value: 'lvIntegratedTeamMember', label: '低压综合服务班班组成员' },
    { value: 'distributionOperationTeamMember', label: '配电运检班班组成员' },
    { value: 'distributionEngineeringTeamMember', label: '配电工程班班组成员' },
  ],
};

// 扁平化的全部岗位（用于按 value 反查 label）
export const POSITIONS = Object.values(POSITIONS_BY_TYPE).flat();

// 根据岗位类型获取该类型下的岗位选项
export const getPositionsByType = (type) => POSITIONS_BY_TYPE[type] || [];

export const findLabel = (list, value) =>
  list?.find((x) => x.value === value)?.label || value || '-';

// 按 value 反查岗位名称（跨所有岗位类型）
export const findPositionLabel = (value) => findLabel(POSITIONS, value);

// 按 value 反查党支部名称
export const findBranchLabel = (value) => findLabel(BRANCHES, value);

// 党支部匹配（兼容历史数据：既匹配 value 'first'，也匹配中文 '第一党支部'）
export const matchBranch = (recordBranch, branch) => {
  if (!branch) return true;
  return recordBranch === branch || recordBranch === findBranchLabel(branch);
};

// ============================================================
// 岗位专属自评表单（按岗位 value 索引，陆续补充 14 个岗位）
// ------------------------------------------------------------
// 结构说明：
//   fullScore   该岗位表单满分
//   sections    若干部分，每部分若干道选择题
//   每道题      key（存库字段名）+ label（题干）+ options（选项挂分值）
// 提交时只存「每道题选了哪个 value」（scores.answers），
// 分数由这里的定义计算；审核端用同一份定义还原每题得分。
// 未配置的岗位继续使用上面的通用 5 项打分表单（SCORE_DIMENSIONS）。
// ============================================================
const yesNoOptions = (score) => [
  { value: 'yes', label: '是', score },
  { value: 'no', label: '否', score: 0 },
];

// 岗位表单定义从 src/lib/forms-data.mjs 导入（单一真源）
// 数据更新：编辑 src/lib/forms-data.mjs 后，前端会自动用上新数据，无需改这里
import * as _formsData from './forms-data.mjs';
export const POSITION_FORMS = _formsData.POSITION_FORMS;
export const buildPositionFormSnapshot = _formsData.buildPositionFormSnapshot;
export const formDefFromSnapshot = _formsData.formDefFromSnapshot;
// 个人覆盖：支持按 work_id 增/删/改某岗位模板
export const USER_FORM_OVERRIDES = _formsData.USER_FORM_OVERRIDES;
export const fill = _formsData.fill;
export const applyUserFormOverrides = _formsData.applyUserFormOverrides;

// 取某岗位的专属表单定义（未配置返回 null，页面回落到通用表单）
// workId：传入时按 USER_FORM_OVERRIDES[workId] 合并（position 不匹配则整条配置失效，
//        返回基础定义）。不传 workId 保持向后兼容，返回原始 14 套模板。
export const getPositionForm = (position, workId) => {
  const base = POSITION_FORMS[position] || null;
  if (!base || !workId) return base;
  const overrides = USER_FORM_OVERRIDES[workId];
  if (!overrides || overrides.position !== position) return base;
  return applyUserFormOverrides(base, overrides);
};

// 按答卷计算总分
//   选择题：answers[it.key] = 选项 value   → 取 options[].score
//   填空题：兼容两种形状
//     - 新：{ count, reason }  → 取 count
//     - 旧：直接一个数字        → 兼容读取
export const calcFormTotal = (formDef, answers = {}) => {
  let total = 0;
  formDef?.sections?.forEach((sec) =>
    sec.items.forEach((it) => {
      if (it.type === 'fill') {
        const raw = answers[it.key];
        const count = Number(raw?.count ?? raw) || 0;
        total += count * (it.unitScore || 0);
      } else {
        const opt = it.options?.find((o) => o.value === answers[it.key]);
        total += opt?.score || 0;
      }
    })
  );
  return total;
};

// ============================================================
// 管理员注册密钥 —— 已停用
// ------------------------------------------------------------
// 改用「工作证编号白名单」方案（白名单仅存于后端，见 server/admin-whitelist.mjs）：
//   - 名单内 4 个工作证编号自动注册为管理员（W-0001/0002=分管领导, W-0003/0004=组织委员）
//   - 名单内 46 个工作证编号自动注册为普通党员（W-0005~W-0050）
//   - 名单外的编号拒绝注册：后端返回 WORK_ID_NOT_IN_LIST
// 前端不做白名单校验，提交时由后端判定。
// 重新启用密钥方案时，参见 server/server.js 顶部注释。
// ============================================================