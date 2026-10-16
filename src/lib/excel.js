import * as XLSX from 'xlsx';
import {
  SCORE_DIMENSIONS,
  calcGrade,
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from './constants';

// 把评价列表导出成 .xlsx
export function exportEvaluationsToExcel(list, year) {
  const header = [
    '序号',
    '姓名',
    '岗位',
    '岗位类型',
    '党支部',
    '年度',
    '提交时间',
    '政治素质',
    '工作业绩',
    '联系群众',
    '纪律作风',
    '先锋模范',
    '自评总分',
    '审核状态',
    '审核人',
    '审核分',
    '审核评语',
    '审核时间',
  ];

  const rows = list.map((it, i) => [
    i + 1,
    it.name,
    findPositionLabel(it.position),
    findLabel(POSITION_TYPES, it.positionType),
    it.partyBranch,
    it.year,
    it.createdAt,
    ...SCORE_DIMENSIONS.map((d) => it.scores?.[d.key] ?? 0),
    it.selfTotal,
    it.reviewStatus === 'reviewed' ? '已审核' : '待审核',
    it.reviewerName || '',
    it.reviewScore ?? '',
    it.reviewComment || '',
    it.reviewedAt || '',
  ]);

  const aoa = [header, ...rows];

  // 维度小计行（用于打印底栏）
  const summary = [
    '合计',
    '',
    '',
    '',
    '',
    '',
    '',
    ...SCORE_DIMENSIONS.map((d) => {
      const sum = list.reduce((s, x) => s + Number(x.scores?.[d.key] || 0), 0);
      const avg = list.length ? (sum / list.length).toFixed(1) : 0;
      return `${sum}（均 ${avg}）`;
    }),
    list.reduce((s, x) => s + Number(x.selfTotal || 0), 0),
    calcGrade(list.reduce((s, x) => s + Number(x.selfTotal || 0), 0)),
    '',
    '',
    '',
    '',
    '',
  ];
  aoa.push(summary);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map((h) => ({ wch: h.length * 1.6 + 4 }));

  const wb = XLSX.utils.book_new();
  const sheetName = `党员评价-${year || '全部'}`;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const filename = `党员评价_${year || '全部年度'}_${Date.now()}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// 支部月度积分汇总导出（组织委员「支部积分汇总」页的导出按钮）
// ---------------------------------------------------------------
// 一人一行；两栏「具体事宜」在单元格内按点换行：
//   1. 题干 2次 事由：xxx
//   2. ...
// 履职贡献最后一点是审核理由（reviewComment）。
// 文件名：{年}年{月}月供电服务二中心{第几党支部}全体党员月度积分汇总.xlsx
export function exportBranchMonthlySummaryToExcel({
  rows = [],
  year,
  month,
  branchLabel = '',
} = {}) {
  const fmtMatters = (items = [], extraComment = '') => {
    const lines = (items || []).map(
      (m, i) =>
        `${i + 1}. ${m.label || ''} ${m.count}${m.unit || '项'}${
          m.reason ? ` 事由：${m.reason}` : ''
        }`
    );
    const comment = String(extraComment || '').trim();
    if (comment) lines.push(`${lines.length + 1}. ${comment}`);
    return lines.join('\n');
  };

  // 跨支部（「全体成员」）导出时多一列「党支部」，便于区分；
  // 单支部导出保持原有列顺序不变
  const multiBranch = new Set((rows || []).map((r) => r.branch).filter(Boolean)).size > 1;

  const header = [
    '序号',
    '姓名',
    '工号',
    ...(multiBranch ? ['党支部'] : []),
    '具体岗位',
    '岗位类型',
    '基础积分',
    '基础积分具体事宜',
    '履职贡献积分',
    '履职贡献具体事宜',
    '总分',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    r.name || '',
    r.workId || '',
    ...(multiBranch ? [findBranchLabel(r.branch)] : []),
    findPositionLabel(r.position),
    findLabel(POSITION_TYPES, r.positionType),
    Number(r.basic ?? 0),
    fmtMatters(r.basicMatters),
    Number(r.contribution ?? 0),
    fmtMatters(r.contributionMatters, r.contributionComment),
    Number(r.total ?? 0),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  // 具体事宜两列给宽一点，便于直接查看（单元格内换行在 Excel 里双击可见完整内容）
  ws['!cols'] = [
    6, 10, 12,
    ...(multiBranch ? [14] : []),
    22, 18, 10, 60, 12, 60, 10,
  ].map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '月度积分汇总');

  const filename = `${year}年${month}月供电服务二中心${branchLabel}全体党员月度积分汇总.xlsx`;
  XLSX.writeFile(wb, filename);
}

// 年度积分汇总导出（与月度同构，列换成年度口径）
//   文件名：{year}年度供电服务二中心{支部}全体党员年度积分汇总.xlsx
export function exportBranchAnnualSummaryToExcel({
  rows = [],
  year,
  branchLabel = '',
} = {}) {
  // 具体事宜：是非题只有「题干 + 事由」；填空题是「题干 + 项数 + 事由」
  const fmtMatters = (items = []) =>
    (items || [])
      .map((m, i) => {
        const head = `${i + 1}. ${m.label || ''}`;
        const cnt = m.bool ? '' : ` ${m.count}${m.unit || '项'}`;
        return `${head}${cnt}${m.reason ? ` 事由：${m.reason}` : ''}`;
      })
      .join('\n');

  const multiBranch = new Set((rows || []).map((r) => r.branch).filter(Boolean)).size > 1;

  const header = [
    '序号',
    '姓名',
    '工号',
    ...(multiBranch ? ['党支部'] : []),
    '具体岗位',
    '岗位类型',
    '基础积分（月度平均）',
    '履职贡献积分（月度平均）',
    '年度专项加分',
    '年度专项加分具体事宜',
    '年度红线扣分',
    '年度红线扣分具体事宜',
    '总分',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    r.name || '',
    r.workId || '',
    ...(multiBranch ? [findBranchLabel(r.branch)] : []),
    findPositionLabel(r.position),
    findLabel(POSITION_TYPES, r.positionType),
    Number(r.basic ?? 0),
    Number(r.contribution ?? 0),
    Number(r.creditScore ?? 0),
    fmtMatters(r.creditMatters),
    Number(r.disciplineScore ?? 0),
    fmtMatters(r.disciplineMatters),
    Number(r.total ?? 0),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = [
    6, 10, 12,
    ...(multiBranch ? [14] : []),
    22, 18, 14, 16, 12, 60, 12, 60, 10,
  ].map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '年度积分汇总');

  const filename = `${year}年度供电服务二中心${branchLabel}全体党员年度积分汇总.xlsx`;
  XLSX.writeFile(wb, filename);
}