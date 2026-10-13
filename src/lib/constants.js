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

export const POSITION_FORMS = {
  distributionTech: {
    label: '配网专业技术岗',
    fullScore: 45,
    sections: [
      {
        title: '第一部分 · 基础履职',
        items: [
          {
            key: 'baseDuty',
            label:
              '按中心要求完成配电网网架规划、成资本项目储备、评审、上报、网架问题治理、配电台区超重载、配变越限治理、10千伏线路线损指标管控、配电自动化布点、自动化设备消缺、三大类缺陷（树线、绝缘裸露点、局放异常）消缺、发电作业、停电计划上报、数据质量治理等本职工作',
            options: [
              { value: 'yes', label: '满足（已按要求完成上述本职工作）', score: 20 },
              { value: 'no', label: '不满足（未全部完成）', score: 0 },
            ],
          },
        ],
      },
      {
        title: '第二部分 · 提质赋分',
        hint: '依据：市公司发布的月度经营简报、二中心业务管控周报',
        items: [
          {
            key: 'q1',
            label:
              '攻克技术难题、优化技术方案、压降设备故障、供电可靠性提升、代维驻点建设等专业管理经验被上级公司肯定或推广',
            options: yesNoOptions(5),
          },
          {
            key: 'q2',
            label: '牵头完成中心布置的急难险重专项任务',
            options: yesNoOptions(5),
          },
          {
            key: 'q3',
            label: '牵头制定中心各项内控制度、管理办法、实施方案等',
            options: yesNoOptions(5),
          },
          {
            key: 'q4',
            label: '负责的专业领域指标在主城区四个中心排名',
            options: [
              { value: 'rank1', label: '排名第一', score: 10 },
              { value: 'rank2', label: '排名第二', score: 8 },
              { value: 'rank3', label: '排名第三', score: 0 },
              { value: 'rank4', label: '排名第四', score: 0 },
            ],
          },
        ],
      },
    ],
  },
};

// 取某岗位的专属表单定义（未配置返回 null，页面回落到通用表单）
export const getPositionForm = (position) => POSITION_FORMS[position] || null;

// 按答卷（{ 题key: 选项value }）计算总分
export const calcFormTotal = (formDef, answers = {}) => {
  let total = 0;
  formDef?.sections?.forEach((sec) =>
    sec.items.forEach((it) => {
      const opt = it.options.find((o) => o.value === answers[it.key]);
      total += opt?.score || 0;
    })
  );
  return total;
};

// 满分不一定是 100，等级按得分比例换算（90%/75%/60%）
export const calcFormGrade = (total, fullScore = 100) => {
  const pct = fullScore ? (total / fullScore) * 100 : 0;
  if (pct >= 90) return '优秀';
  if (pct >= 75) return '良好';
  if (pct >= 60) return '合格';
  return '不合格';
};

// ============================================================
// 管理员注册密钥
// ------------------------------------------------------------
// 密钥已移到后端校验，见 server/server.js 的 ADMIN_INVITE_CODES
// （两个党支部各一把，互不通用）。
// 原因：前端源码会被打包发给每个访客（F12 即可搜到），放在这里等于公开。
// 前端现在只负责收集密钥、原样提交给后端，由后端决定是否通过。
// 密钥要求：8 位，数字 + 字母组合（建议避开易混字符 0/O、1/l/I）。
// ============================================================