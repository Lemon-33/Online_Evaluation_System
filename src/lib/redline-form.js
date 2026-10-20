// ============================================================
// 年度红线扣分问卷（支部书记 admin_type=0 审核，一年一人一条）
// ------------------------------------------------------------
// 题型：每道题是「有无」选择题 + 一个具体事由框
//   选「有」→ 扣 X 分（下面的 score 为负数）
//   选「无」→ 不扣分
//   选「有」时事由必填（说明具体情况）；选「无」可留空
// 答案形状（存库 discipline.scores.answers）：
//   answers[key] = { value: 'yes' | 'no', reason }
// 计分：最终得分 = Σ（选「有」的题的 score） → 恒 ≤ 0
//   展示层一般显示「扣 X 分」= |最终得分|
// 注：原始需求第 5 条含两种不同分值的情形（安全责任事故 30 分 / 严重违章 10 分），
//   这里拆成两道独立题目（r5 / r6），否则一道题没法表达两种扣分额度。
// ============================================================

export const REDLINE_YES = 'yes'; // 有（扣分项成立）
export const REDLINE_NO = 'no'; // 无（不扣分）

export const REDLINE_ITEMS = [
  { key: 'r1', label: '党员因违反党章党规受到党纪政纪处分', score: -30 },
  { key: 'r2', label: '党员因违法犯罪行为受到处罚', score: -50 },
  { key: 'r3', label: '党员发生违反中央八项规定精神问题', score: -30 },
  { key: 'r4', label: '党员因违反公司各项规章制度受到处罚', score: -20 },
  { key: 'r5', label: '发生党员责任的安全责任事故', score: -30 },
  {
    key: 'r6',
    label: '党员负责的作业现场出现被上级公司查见通报的严重违章',
    score: -10,
  },
  { key: 'r7', label: '党员发生影响职工队伍稳定的言论散布、传播行为', score: -20 },
  { key: 'r8', label: '党员发生信访、上访事件', score: -20 },
  {
    key: 'r9',
    label: '党员发生较大不良影响的属于个人责任的供电服务投诉',
    score: -20,
  },
  { key: 'r10', label: '党员发生影响公司形象的行风、舆情事件', score: -20 },
];

// 每题的选项（有 / 无）：label 里带上分值，审核人一眼能看到扣多少
export const redlineOptionsOf = (it) => [
  { value: REDLINE_NO, label: '无' },
  { value: REDLINE_YES, label: `有（扣 ${Math.abs(it.score)} 分）` },
];

// 读取某题的 choices / reason（兼容老数据：直接存 'yes'/'no' 字符串）
export const redlineValueOf = (v) =>
  (v && typeof v === 'object' ? v.value : v) || REDLINE_NO;
export const redlineReasonOf = (v) =>
  v && typeof v === 'object' ? String(v.reason ?? '') : '';

// 答案规范化：统一成 { value, reason }，缺项补「无 + 空事由」
export function normalizeRedlineAnswers(raw = {}) {
  const out = {};
  for (const it of REDLINE_ITEMS) {
    const v = raw?.[it.key];
    out[it.key] = {
      value: redlineValueOf(v) === REDLINE_YES ? REDLINE_YES : REDLINE_NO,
      reason: redlineReasonOf(v),
    };
  }
  return out;
}

// 最终得分（≤ 0）：只有选「有」的题才计分
export const calcRedlineScore = (answers = {}) =>
  REDLINE_ITEMS.reduce((sum, it) => {
    const v = answers[it.key];
    return redlineValueOf(v) === REDLINE_YES ? sum + (it.score || 0) : sum;
  }, 0);

// 扣分合计（正数，用于展示「扣 X 分」）
export const calcRedlineDeduction = (answers = {}) =>
  Math.abs(calcRedlineScore(answers));

// 某题是否命中（选了「有」）
export const isRedlineHit = (v) => redlineValueOf(v) === REDLINE_YES;

// 提交时的快照：把「题干 + 选项 + 分值 + 事由」一起落库，便于以后改题也能回放历史
export function buildRedlineSnapshot(answers = {}) {
  const snap = {};
  for (const it of REDLINE_ITEMS) {
    const v = answers[it.key] || {};
    snap[it.key] = {
      label: it.label, // 题干
      score: it.score, // 选「有」时的分值（负）
      value: redlineValueOf(v), // 审核人选择：yes / no
      reason: redlineReasonOf(v), // 具体事由
      deduction: isRedlineHit(v) ? Math.abs(it.score || 0) : 0, // 该题实际扣分（正）
    };
  }
  return snap;
}
