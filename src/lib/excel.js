import * as XLSX from 'xlsx';
import { SCORE_DIMENSIONS, calcGrade, POSITION_TYPES, findLabel, findPositionLabel } from './constants';

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