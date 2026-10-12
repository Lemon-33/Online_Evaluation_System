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
// 管理员注册密钥
// ------------------------------------------------------------
// 【要改就改这里】只有输入正确的密钥，才能注册成「管理员」。
// 要求：8 位，数字 + 字母（大小写均可）组合。
// 建议避开易混字符：0 / O、1 / l / I
// ============================================================
export const ADMIN_INVITE_CODE = 'K9mQ4xZ7';