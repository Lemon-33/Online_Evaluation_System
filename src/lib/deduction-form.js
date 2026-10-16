// 基础积分评价 — 扣分问卷定义（组织委员 admin_type=1 使用）
// ---------------------------------------------------------------
// 题目结构参考 src/lib/forms-data.mjs 中 fill(unitScore, unit) 的设计：
//
//   {
//     key, type: 'fill',
//     label,                                    // 题干
//     unitScore: -10,                           // 每发生「一单位」扣多少分（负数）
//     unit: '次' | '项' | '分' | ...            // 计量单位
//     hint,                                     // 提示文案
//     hasReason: true,                          // 与履职贡献问卷一致：每题都要填「具体事由」
//     min, max,                                 // 输入范围
//   }
//
// 答案形状（与履职贡献问卷一致）：
//   answers[key] = { count, reason }
//     count  非负整数（次数 / 酌情扣分值）
//     reason 该题具体事由（组织委员填写）
//   兼容：老数据 answers[key] 是直接数字 → 按 count 读，reason 视为空
//
// 计分：
//   - 初始得分 DEDUCTION_BASE_SCORE = 60
//   - 组织委员填的实际发生数 n 为非负整数
//   - 每题得分 = n × unitScore    （unitScore 通常为负，故得分通常 ≤ 0）
//   - 累加得分 = Σ (n × unitScore)
//   - 最终得分 = max(0, 60 + 累加得分)
//
// 题目来源：BasicRating 评审需求「组织生活参与不规范 / 党员基本义务履行
//           不到位 / 党内纪律与组织执行力不足」三大类。

export const DEDUCTION_BASE_SCORE = 60;

// 仿 forms-data.mjs：在题目定义处一行内展开 fill 字段，看着更紧凑
//   { key, label, ...fill(-10, '次', '每次扣10分') }
//        其中 fill 返回 { type:'fill', unitScore, unit, hint, hasReason:true, min:0, max:30 }
//   hasReason: true = 与履职贡献问卷一致，每题下方都要填「具体事由」（存 reason）
const fill = (unitScore, unit = '项', hint = '') => ({
  type: 'fill',
  unitScore,
  unit,
  hint,
  hasReason: true,
  min: 0,
  max: 30,
});

export const DEDUCTION_SECTIONS = [
  {
    title: '一、组织生活参与不规范',
    items: [
      {
        key: 'q1_1',
        label:
          '未履行正规请假手续、无故缺席「三会一课」、主题党日、组织生活会、廉洁警示教育、支部集中学习等党内组织生活',
        ...fill(-10, '次', '每次扣10分'),
      },
      {
        key: 'q1_2',
        label: '参加各类党内组织生活出现迟到、早退现象',
        // 规则：每次扣 3 分；当月累计 3 次及以上时每次扣 6 分（组织委员按实际折算填写）
        ...fill(-3, '次', '每次扣3分；当月累计 3 次及以上时每次扣 6 分（请按规则折算填写，即当迟到次数大于等于3次时将次数翻倍后再填写）'),
      },
      {
        key: 'q1_3',
        label:
          '组织生活会中未按要求开展自我批评、相互批评，敷衍应对、流于形式',
        ...fill(-5, '次', '每次扣 5 分'),
      },
    ],
  },
  {
    title: '二、党员基本义务履行不到位',
    items: [
      {
        key: 'q2_1',
        label: '无正当理由未按时、足额、主动缴纳党费',
        ...fill(-5, '次', '每次扣 5 分'),
      },
      {
        key: 'q2_2',
        label:
          '未完成支部下达的月度理论学习规定篇目，未完成线上专题培训、专项学习任务',
        ...fill(-4, '次', '每次扣 4 分'),
      },
      {
        key: 'q2_3',
        label:
          '未按支部要求按时提交学习心得、思想汇报、研讨材料、专项报告等书面材料',
        ...fill(-4, '次', '每次扣 4 分'),
      },
      {
        key: 'q2_4',
        label:
          '未按年度、周期要求参加党员轮训、党性教育、专项培训等教育培训',
        ...fill(-10, '次', '每次扣 10 分'),
      },
    ],
  },
  {
    title: '三、党内纪律与组织执行力不足',
    items: [
      {
        key: 'q3_1',
        label:
          '参加党内各类学习、会议、活动期间，发表不当言论、消极言论，造成不良影响',
        ...fill(-10, '次', '每次扣 10 分'),
      },
      {
        key: 'q3_2',
        label:
          '无故推诿、拒绝认领党员责任区攻坚任务，拒不参与总支、支部组织的党员突击队、党员志愿服务、攻坚专项行动等集体工作',
        ...fill(-6, '次', '每次扣 6 分'),
      },
      {
        key: 'q3_3',
        label:
          '存在其他违反党员基本义务、党内规章制度、支部管理要求的行为',
        // 酌情扣分：组织委员直接填「扣多少分」，unit 用「分」+ unitScore=-1 实现
        unit: '分',
        hint: '支部根据情节轻重酌情扣 2~10 分（直接填扣分值）',
        unitScore: -1,
        type: 'fill',
        hasReason: true,
        min: 0,
        max: 10,
      },
    ],
  },
];

// 把题目拍平便于计算
export const DEDUCTION_ITEMS_FLAT = DEDUCTION_SECTIONS.flatMap((sec) =>
  sec.items.map((it) => ({ ...it, sectionTitle: sec.title }))
);

// 把落库的 rating.snapshot 还原成 formDef 形状（{ sections: [{ title, items }] }）
// ---------------------------------------------------------------
// 用途：只读/编辑回显历史扣分表单时，**按库里的题干渲染**，而不是按当前
//       deduction-form.js。这样即便以后改了题目（改文字/加题/删题/改分值），
//       老记录仍能原样显示"当时组织委员看到的题目与打分"。
// 入参：rating.scores.snapshot
// 返回：null（无 snapshot / 老快照缺 sectionTitle）→ 调用方回落现场定义
export const deductionFormDefFromSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  // 老快照（本功能上线前写入）没有 sectionTitle，无法分组 → 回落现场定义
  const hasSection = Object.values(snapshot).some(
    (s) => s && typeof s === 'object' && s.sectionTitle
  );
  if (!hasSection) return null;
  const order = [];
  const bySection = new Map();
  for (const [key, s] of Object.entries(snapshot)) {
    if (!s || typeof s !== 'object') continue;
    const title = s.sectionTitle || '（历史表单）';
    if (!bySection.has(title)) {
      bySection.set(title, []);
      order.push(title);
    }
    bySection.get(title).push({
      key,
      type: 'fill',
      label: s.label,
      unit: s.unit,
      unitScore: s.unitScore,
      hint: s.hint,
      min: s.min ?? 0,
      max: s.max ?? 30,
    });
  }
  if (!bySection.size) return null;
  return { sections: order.map((t) => ({ title: t, items: bySection.get(t) })) };
};

// 读取某题填写的数量：兼容新形状 { count, reason } 与老形状（直接数字）
export const fillCountOf = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(typeof v === 'object' ? v.count ?? 0 : v);
  return Number.isFinite(n) ? n : 0;
};

// 读取某题填写的原因：老数据（直接数字）没有 reason → 空串
export const fillReasonOf = (v) =>
  v && typeof v === 'object' ? String(v.reason ?? '') : '';

// 计算累加得分（通常为 ≤ 0）：
//   answers[it.key] = { count, reason }（兼容老数据：直接数字）
//   结果 = Σ (count × unitScore)
// items：题集（默认当前定义）；传 snapshot 还原的题集 → 按历史分值计算
export const calcNetScoreDelta = (answers = {}, items = DEDUCTION_ITEMS_FLAT) => {
  let total = 0;
  for (const it of items) {
    const v = answers[it.key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(typeof v === 'object' ? v.count ?? 0 : v);
    if (!Number.isFinite(n)) continue;
    total += n * (it.unitScore || 0);
  }
  return total;
};

// 总扣分（始终为正数或在 0..60）：60 减去「最终得分」的反向表述
export const calcTotalDeduction = (answers = {}, items = DEDUCTION_ITEMS_FLAT) =>
  Math.max(0, -calcNetScoreDelta(answers, items));

// 最终得分：基础分 + 累加得分（≤ 0），最低 0
export const calcFinalScore = (answers = {}, items = DEDUCTION_ITEMS_FLAT) =>
  Math.max(0, DEDUCTION_BASE_SCORE + calcNetScoreDelta(answers, items));
