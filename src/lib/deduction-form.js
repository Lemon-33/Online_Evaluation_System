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
//     min, max,                                 // 输入范围
//   }
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
//   { key, label, ...fill(-10, '次', '每次扣 10 分') }
//        其中 fill 返回 { type:'fill', unitScore, unit, hint, min:0, max:30 }
const fill = (unitScore, unit = '项', hint = '') => ({
  type: 'fill',
  unitScore,
  unit,
  hint,
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
        ...fill(-10, '次', '每次扣 10 分'),
      },
      {
        key: 'q1_2',
        label: '参加各类党内组织生活出现迟到、早退现象',
        // 规则：每次扣 3 分；当月累计 3 次及以上时每次扣 6 分（组织委员按实际折算填写）
        ...fill(-3, '次', '每次扣 3 分；当月累计 3 次及以上时每次扣 6 分（请按规则折算填写）'),
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
        hint: '支部根据情节轻重酌情扣 0~10 分（直接填扣分值）',
        unitScore: -1,
        type: 'fill',
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

// 计算累加得分（通常为 ≤ 0）：
//   answers[it.key] = 数字（组织委员填的非负整数 / 扣分值）
//   结果 = Σ (count × unitScore)
export const calcNetScoreDelta = (answers = {}) => {
  let total = 0;
  for (const it of DEDUCTION_ITEMS_FLAT) {
    const v = answers[it.key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    total += n * (it.unitScore || 0);
  }
  return total;
};

// 总扣分（始终为正数或在 0..60）：60 减去「最终得分」的反向表述
export const calcTotalDeduction = (answers = {}) =>
  Math.max(0, -calcNetScoreDelta(answers));

// 最终得分：基础分 + 累加得分（≤ 0），最低 0
export const calcFinalScore = (answers = {}) =>
  Math.max(0, DEDUCTION_BASE_SCORE + calcNetScoreDelta(answers));
