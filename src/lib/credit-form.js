// ============================================================
// 年度专项加分申报问卷（员工本人一年申报一次，存 credit 表）
// ------------------------------------------------------------
// 两种题型（与「年度红线扣分」/「履职贡献自评」保持一致的思路）：
//   ① type: 'bool'  ——「有无」选择题 + 具体事由（对应规则里**不带**"每项 / 每次 / 每篇"的条款）
//        选「有」→ 按题面分值加分；选「无」→ 不加分；选「有」时必须填事由
//   ② type: 'count' ——「次数」填空题 + 具体事由（对应规则里带"每项 / 每次 / 每篇"的条款）
//        得分 = 次数 × 题面分值；次数 > 0 时必须填事由（写清项目名称 / 时间等）
// 答案形状（存库 credit.scores.answers）：
//   answers[key] = { value: 'yes' | 'no', reason }   （bool 题）
//   answers[key] = { count: 1, reason }              （count 题）
// 计分：selfTotal = Σ（bool 命中分值）+ Σ（count 次数 × 分值）
// 快照：提交时把「题干 + 分值 + 题型 + 当时答案 + 事由」一起落库（snapshot），
//   以后调分值 / 改题干也能原样回放历史申报内容
// 规则来源：业务给定的《年度专项加分规则》四类（荣誉表彰 / 创新创效 / 急难险重 / 示范引领）
//   - 规则中同一条款含多个分档的（如"省级及以上 8 分 / 南京市 6 分 / 省公司 4 分 / 市公司 2 分"），
//     按分档拆成多道独立题（一道题没法表达多种分值），与红线问卷里 r5 / r6 的拆法一致
//   - 「同一事项获不同级别表彰的，以最高级别计分，不重复累加」是**人为判断**，
//     系统无法自动识别，因此在荣誉表彰类顶部提示申报人只勾最高级别那一档，
//     最终由分管领导 / 支部书记在审核时核定
// ============================================================

export const CREDIT_YES = 'yes'; // 有（加分项成立）
export const CREDIT_NO = 'no'; // 无（不加分）

// 填空题的次数上限（防误填）
export const CREDIT_COUNT_MAX = 20;

// ============================================================
// 四类加分事项
// ============================================================
export const CREDIT_SECTIONS = [
  {
    key: 'honor',
    title: '一、荣誉表彰类',
    // 这类条款都不带"每项 / 每次" → 全部是「有无 + 事由」
    note: '同一事项获不同级别表彰的，以最高级别计分，不重复累加（如同一事项同时获省级与市级表彰，只勾选最高级别那一档）。',
    items: [
      { key: 'h1', type: 'bool', score: 20, label: '获省部级荣誉称号（国资委系统劳动模范、江苏省劳动模范、江苏省先进工作者、江苏省优秀共产党员、江苏省道德模范等）' },
      { key: 'h2', type: 'bool', score: 15, label: '获南京市级荣誉称号（南京市劳动模范、南京市先进工作者、南京市优秀共产党员、南京市道德模范等）' },
      { key: 'h3a', type: 'bool', score: 15, label: '获省级技能荣誉称号（江苏工匠等）' },
      { key: 'h3b', type: 'bool', score: 10, label: '获江苏省技术能手、江苏省五一创新能手等' },
      { key: 'h4a', type: 'bool', score: 10, label: '获南京市级技能荣誉称号（南京工匠等）' },
      { key: 'h4b', type: 'bool', score: 8, label: '获评南京市技术能手、南京市五一创新能手等' },
      { key: 'h5a', type: 'bool', score: 15, label: '获省级科技创新表彰（江苏省科技创新奖等）' },
      { key: 'h5b', type: 'bool', score: 10, label: '获江苏省科学技术奖' },
      {
        key: 'h6',
        type: 'bool',
        score: 15,
        label: '获中电联、国网系统荣誉称号或表彰奖励（规则为"参照南京市级相应标准加分"，此处按市级荣誉称号 15 分计）',
      },
      { key: 'h7', type: 'bool', score: 6, label: '获省公司表彰（省公司劳动模范、先进工作者、优秀共产党员、技术能手、科学技术奖等）' },
      { key: 'h8', type: 'bool', score: 3, label: '获市公司表彰（市公司劳动模范、先进工作者、宁电好青年等）' },
      { key: 'h9', type: 'bool', score: 1, label: '获中心层面年度表彰（党员先锋岗、攻坚克难先进个人、优质服务先进个人等）' },
    ],
  },
  {
    key: 'innovation',
    title: '二、创新创效类',
    note: '这类条款按"每项 / 每篇"计分，填次数并写清具体项目；同一成果获多级别奖项的，请只填最高级别那一档。',
    items: [
      { key: 'i1', type: 'count', score: 10, label: '主持或参与技术创新项目获国家专利（每项）' },
      { key: 'i2a', type: 'count', score: 8, label: '主持或参与 QC 成果、管理创新获省级及以上奖项（每项）' },
      { key: 'i2b', type: 'count', score: 6, label: '主持或参与 QC 成果、管理创新获南京市、或中电联、国网系统奖项（每项）' },
      { key: 'i2c', type: 'count', score: 4, label: '主持或参与 QC 成果、管理创新获省公司奖项（每项）' },
      { key: 'i2d', type: 'count', score: 2, label: '主持或参与 QC 成果、管理创新获市公司奖项（每项）' },
      { key: 'i3a', type: 'count', score: 8, label: '主持或参与科技创新项目获省级及以上奖项（每项）' },
      { key: 'i3b', type: 'count', score: 6, label: '主持或参与科技创新项目获南京市、或中电联、国网系统奖项（每项）' },
      { key: 'i3c', type: 'count', score: 4, label: '主持或参与科技创新项目获省公司奖项（每项）' },
      { key: 'i3d', type: 'count', score: 2, label: '主持或参与科技创新项目获市公司奖项（每项）' },
      { key: 'i4', type: 'count', score: 5, label: '参与制定行业标准、企业标准（每项）' },
      { key: 'i5', type: 'count', score: 5, label: '在核心期刊发表专业论文（每篇）' },
      { key: 'i6', type: 'count', score: 3, label: '在上级公司试点工作中，参与制定的方案被采纳实施并产生实效（每项）' },
      { key: 'i7', type: 'count', score: 3, label: '在专业领域提出优化业务流程、考核指标设置等合理化建议被采纳实施并产生实效（每项）' },
    ],
  },
  {
    key: 'emergency',
    title: '三、急难险重任务类',
    note: '这类条款按"每次"计分，填次数并写清具体任务与时间。',
    items: [
      { key: 'e1', type: 'count', score: 5, label: '在重大保供电任务中表现突出，获地方政府或上级公司通报表扬（每次）' },
      { key: 'e2', type: 'count', score: 5, label: '在抢险救灾、事故抢修中主动请缨、冲锋在前，快速恢复供电，获地方政府或上级公司通报表扬（每次）' },
      { key: 'e3', type: 'count', score: 5, label: '主动承担并完成民生用电历史遗留问题专项攻坚任务（每次）' },
      { key: 'e4', type: 'count', score: 5, label: '牵头完成中心服务保障区域重点网架项目前期规划审批、设备布点、政处协调等急难险重专项任务（每次）' },
      { key: 'e5', type: 'count', score: 5, label: '牵头推动群众急难愁盼用电难题解决获地方政府肯定或典型做法被上级公司推广（每次）' },
    ],
  },
  {
    key: 'lead',
    title: '四、示范引领类',
    note: '不带"每项 / 每次"的条款选「有 / 无」，带"每项 / 每次"的填次数。',
    items: [
      {
        key: 'l1',
        type: 'bool',
        score: 5,
        label: '担任党员责任区责任人，责任区承担的专业考核指标年度完成值皆高于上级公司对中心年度考核结果',
      },
      { key: 'l2a', type: 'count', score: 5, label: '牵头负责的专业考核指标，主动对接上级公司专业部门争取加分事项，年度赋分值在主城区四个中心排名第一（每项）' },
      { key: 'l2b', type: 'count', score: 2, label: '牵头负责的专业考核指标，年度赋分值在主城区四个中心排名第二（每项）' },
      { key: 'l3a', type: 'count', score: 5, label: '牵头完成的专项工作形成的典型经验在国网动态作经验交流（每次）' },
      { key: 'l3b', type: 'count', score: 3, label: '牵头完成的专项工作形成的典型经验在省公司动态信息作经验交流（每次）' },
      { key: 'l4a', type: 'count', score: 5, label: '牵头开展的党建工作、业务工作、党业融合工作等形成的实践案例，在省公司以上层面作宣传推广（每次）' },
      { key: 'l4b', type: 'count', score: 3, label: '牵头开展的实践案例在省公司层面作宣传推广（每次）' },
      { key: 'l4c', type: 'count', score: 1, label: '牵头开展的实践案例在市公司层面作宣传推广（每次）' },
      { key: 'l5a', type: 'bool', score: 5, label: '参加上级公司组织的专业技能竞赛，取得全国名次' },
      { key: 'l5b', type: 'bool', score: 3, label: '参加上级公司组织的专业技能竞赛，取得省内名次' },
      { key: 'l6', type: 'bool', score: 2, label: '"师带徒"结对帮带青年员工，帮带对象在上级公司组织的专业技能竞赛取得名次' },
    ],
  },
];

// 拍平后的题目列表（顺序即申报页的展示顺序）
export const CREDIT_ITEMS = CREDIT_SECTIONS.flatMap((sec) => sec.items);

// 取题目定义
export const findCreditItem = (key) => CREDIT_ITEMS.find((it) => it.key === key) || null;

// bool 题的选项（label 里带上分值，一眼能看到加多少）
export const creditOptionsOf = (it) => [
  { value: CREDIT_NO, label: '无' },
  { value: CREDIT_YES, label: `有（加 ${it.score} 分）` },
];

// 读取某题的 value / count / reason（兼容老数据：直接存 'yes'/'no' 字符串或数字）
export const creditValueOf = (v) => (v && typeof v === 'object' ? v.value : v) || CREDIT_NO;
export const creditCountOf = (v) => {
  const n = v && typeof v === 'object' ? Number(v.count) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
export const creditReasonOf = (v) => (v && typeof v === 'object' ? String(v.reason ?? '') : '');

// 答案规范化：统一成 { value, count, reason }，缺项补「无 / 0 + 空事由」
export function normalizeCreditAnswers(raw = {}) {
  const out = {};
  for (const it of CREDIT_ITEMS) {
    const v = raw?.[it.key];
    out[it.key] =
      it.type === 'bool'
        ? {
            value: creditValueOf(v) === CREDIT_YES ? CREDIT_YES : CREDIT_NO,
            count: 0,
            reason: creditReasonOf(v),
          }
        : {
            value: CREDIT_NO,
            count: creditCountOf(v),
            reason: creditReasonOf(v),
          };
  }
  return out;
}

// 某题是否命中（bool 选了「有」/ count > 0）
export const isCreditHit = (it, v) =>
  it.type === 'bool' ? creditValueOf(v) === CREDIT_YES : creditCountOf(v) > 0;

// 某题得分：bool → 分值；count → 次数 × 分值
export const creditScoreOf = (it, v) =>
  it.type === 'bool'
    ? creditValueOf(v) === CREDIT_YES
      ? it.score
      : 0
    : creditCountOf(v) * it.score;

// 自报总分（正数）
export function calcCreditScore(answers = {}) {
  return CREDIT_ITEMS.reduce((sum, it) => sum + creditScoreOf(it, answers[it.key]), 0);
}

// 命中但未填事由的题（提交校验用）：bool 选「有」/ count > 0 都必须写事由
export function missingCreditReasonKeys(answers = {}) {
  return CREDIT_ITEMS.filter(
    (it) => isCreditHit(it, answers[it.key]) && !creditReasonOf(answers[it.key]).trim()
  ).map((it) => it.key);
}

// 提交时的快照：题干 + 分值 + 题型 + 当时答案 + 事由，便于以后改规则也能回放历史
export function buildCreditSnapshot(answers = {}) {
  const snap = {};
  for (const it of CREDIT_ITEMS) {
    const v = answers[it.key] || {};
    snap[it.key] = {
      label: it.label, // 题干
      score: it.score, // 分值（bool：命中即加；count：每次 / 每项加）
      type: it.type, // bool / count
      value: creditValueOf(v), // bool 题的选择
      count: creditCountOf(v), // count 题的次数
      reason: creditReasonOf(v), // 具体事由
      gained: creditScoreOf(it, v), // 该题实际加分
    };
  }
  return snap;
}
