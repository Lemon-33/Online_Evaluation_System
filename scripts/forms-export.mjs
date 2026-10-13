// 把 src/lib/forms-data.mjs 里的 POSITION_FORMS 导出为宽表 Excel
// 用法：node scripts/forms-export.mjs   （输出到桌面 岗位表单定义.xlsx）
import * as XLSX from 'xlsx';
import path from 'path';
import { POSITION_FORMS } from '../src/lib/forms-data.mjs';

const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');

const HEADERS = [
  'position', 'sectionTitle', 'itemKey', 'itemLabel',
  'questionType', 'unitScore', 'unit',
  'opt1Label', 'opt1Score',
  'opt2Label', 'opt2Score',
  'opt3Label', 'opt3Score',
  'opt4Label', 'opt4Score',
  'opt5Label', 'opt5Score',
];

const rows = [];
let total = 0;
for (const [posKey, form] of Object.entries(POSITION_FORMS)) {
  for (const sec of form.sections || []) {
    for (const item of sec.items || []) {
      const isFill = item.type === 'fill';
      const row = {
        position: posKey,
        sectionTitle: sec.title,
        itemKey: item.key,
        itemLabel: item.label,
        questionType: isFill ? 'fill' : 'choice',
        unitScore: isFill ? item.unitScore : '',
        unit: isFill ? item.unit : '',
      };
      (item.options || []).forEach((o, i) => {
        const n = i + 1;
        if (n > 5) return; // 最多 5 个选项
        row[`opt${n}Label`] = o.label;
        row[`opt${n}Score`] = o.score;
      });
      rows.push(row);
      total++;
    }
  }
}

const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '岗位表单');

// 列宽
ws['!cols'] = [
  { wch: 30 }, // position
  { wch: 14 }, // sectionTitle
  { wch: 10 }, // itemKey
  { wch: 70 }, // itemLabel
  { wch: 12 }, // questionType
  { wch: 10 }, // unitScore
  { wch: 8 },  // unit
  ...Array(10).fill({ wch: 18 }), // 5 组 opt label+score
];

// 第一行（表头）冻结
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

const out = path.join(desktop, '岗位表单定义.xlsx');
XLSX.writeFile(wb, out);

const positions = Object.keys(POSITION_FORMS).length;
const avgRows = (total / positions).toFixed(1);
const fillCount = rows.filter(r => r.questionType === 'fill').length;
const choiceCount = total - fillCount;
console.log(`已导出：${out}`);
console.log(`${positions} 个岗位 / ${total} 行（${choiceCount} 选择 + ${fillCount} 填空），平均 ${avgRows} 行/岗位`);
