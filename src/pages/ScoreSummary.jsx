// 积分汇总（组织委员 / 支部书记 / 分管领导可见）
// ------------------------------------------------------------
// 可见范围（后端按身份限定）：
//   - 组织委员：只能看自己支部（前端筛选框锁定）
//   - 支部书记 / 分管领导：可在「第一党支部 / 第二党支部 / 全体成员」之间切换
// ------------------------------------------------------------
// 两个子模块（进入页面后用 Tabs 切换）：
//   ① 月度积分汇总：年份 + 月份下拉 → 本支部所有党员该月的基础积分 / 履职贡献 / 总分
//   ② 年度积分汇总：年度下拉 → 基础积分（月度平均）/ 履职贡献（月度平均）/
//      年度专项加分（credit.reviewScore）/ 年度红线扣分（discipline.reviewScore）/ 总分
// 月度口径与「个人积分查询」一致（只统计已审核；履职贡献封顶 40；无记录按 0 分），
//   但没有记录 / 未审核的人照常出现在列表里（按 0 分计），并按总分从高到低排序。
// 「具体事宜」内容：
//   - 基础积分：数量不为 0 的扣分题，按「序号. 题干 + 几次（单位）+ 事由」分点列出
//   - 履职贡献：数量不为 0 的填空题（加分题、扣分题都列），格式同上；
//               最后再加一点：审核理由（evaluation.reviewComment）
// 列表里只显示条数（放不下全文本），点「查看」在弹窗里看完整内容。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DownloadOutlined,
  EyeOutlined,
  LineChartOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  BRANCHES,
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import {
  exportBranchMonthlySummaryToExcel,
  exportBranchAnnualSummaryToExcel,
} from '../lib/excel';
import { getBranchMonthlySummary, getBranchAnnualSummary } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

const { Title, Text } = Typography;

const currentYear = dayjs().year();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => ({
  value: y,
  label: `${y} 年`,
}));
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1} 月`,
}));
// 支部筛选（组织委员 / 支部书记 / 分管领导都可用；'all' = 全体成员）
const BRANCH_OPTIONS = [{ value: 'all', label: '全体成员' }, ...BRANCHES];

// 列表里的「具体事宜」：内容较长放不下，只显示条数，完整内容点「查看」在弹窗里看
// 没有具体事宜 → **直接留空**，不写「无」之类的提示词
const MattersCell = ({ items = [] }) =>
  items.length ? <Tag color="blue">{`共 ${items.length} 项`}</Tag> : null;

// 弹窗里的「具体事宜」：按点分条展开
//   格式：序号. 题干　几次（单位按题目）　事由：reason
//   extraComment（履职贡献的 reviewComment 审核理由）作为最后一点附在末尾
// 没有内容 → **直接留空**，不写「暂无」之类的提示词
function MattersBlock({ items = [], extraComment = '' }) {
  const comment = String(extraComment || '').trim();
  if (!items.length && !comment) return null;
  return (
    <div>
      {items.map((m, i) => (
        <div key={m.key || i} style={{ marginBottom: 8, lineHeight: 1.7 }}>
          {i + 1}. {m.label}
          {/* 是非题不带项数（题干 + 事由）；填空题带「几次 / 几项」 */}
          {!m.bool && (
            <span style={{ marginLeft: 8, fontWeight: 600 }}>
              {m.count}
              {m.unit || '项'}
            </span>
          )}
          {m.reason ? (
            <span style={{ marginLeft: 8 }}>事由：{m.reason}</span>
          ) : null}
        </div>
      ))}
      {comment ? (
        <div style={{ marginBottom: 8, lineHeight: 1.7 }}>
          {items.length + 1}. {comment}
        </div>
      ) : null}
    </div>
  );
}

export default function ScoreSummary() {
  const { user } = useAuth();
  const [tab, setTab] = useState('monthly');

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />
        支部积分汇总
      </Title>

      <Card style={{ marginTop: 16 }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'monthly', label: '月度积分汇总', children: <MonthlySummary /> },
            { key: 'annual', label: '年度积分汇总', children: <AnnualSummary /> },
          ]}
        />
      </Card>
    </div>
  );
}

// 每列的「基础宽度」：内容刚好放得下的最小宽度
// 表格比这些宽度之和更宽时，多出来的空间**平均**加给每一列（不再让某一列独占）
const COL_BASE_WIDTHS = {
  name: 110,
  branch: 120,        // 「党支部」列：只在「全体成员」模式下出现
  position: 180,
  basic: 100,
  basicMatters: 88,   // 只显示「共 N 项」，两位数也放得下
  contribution: 120,
  contributionMatters: 88,
  total: 100,
  action: 80,
};
const COL_KEYS = Object.keys(COL_BASE_WIDTHS);
// 「党支部」列只在全体模式下参与展示与宽度平均分配
const colKeysOf = (allMode) =>
  allMode ? COL_KEYS : COL_KEYS.filter((k) => k !== 'branch');
const baseTotalOf = (keys) => keys.reduce((s, k) => s + COL_BASE_WIDTHS[k], 0);

// ===== 子模块 ①：月度积分汇总 =====
function MonthlySummary() {
  const { user } = useAuth(); // 导出文件名要用支部名（第一/第二党支部）
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null); // 当前查看的条目（null = 弹窗关闭）
  // 支部筛选：默认本人支部；组织委员 / 书记 / 分管领导都可改（含「全体成员」）
  const [branchFilter, setBranchFilter] = useState(user?.branch || '');

  // 测量表格可用宽度：用于把剩余空间平均分给每一列
  const tableWrapRef = useRef(null);
  const [tableW, setTableW] = useState(0);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    setTableW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      setTableW(entries[0]?.contentRect?.width || 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 剩余空间 / 列数 = 每列再加多少（容器不够宽时按基础宽度，表格横向滚动）
  // 「党支部」列只在「全体成员」模式下参与平均分配
  const allMode = branchFilter === 'all';
  const activeKeys = colKeysOf(allMode);
  const baseTotal = baseTotalOf(activeKeys);
  const extraPerCol =
    tableW > baseTotal ? Math.floor((tableW - baseTotal) / activeKeys.length) : 0;
  const colW = (k) => COL_BASE_WIDTHS[k] + extraPerCol;
  const tableScrollX = baseTotal + extraPerCol * activeKeys.length;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        // 组织委员传什么后端都会强制改回本人支部，这里直接把 branchFilter 传过去更直观
        const data = await getBranchMonthlySummary({
          year,
          month,
          branch: branchFilter || undefined,
        });
        if (!cancelled) setRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e) {
        if (!cancelled) {
          message.error(e?.message || '加载失败');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, branchFilter]);

  // 后端已按总分降序返回；这里按总分再排一次，防止前端筛选状态导致顺序漂移
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.total || 0) - (a.total || 0)),
    [rows]
  );

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      width: colW('name'),
      align: 'center',
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          <span className="muted" style={{ fontSize: 12 }}>{r.workId}</span>
        </Space>
      ),
    },
    // 「党支部」列：仅在「全体成员」模式下出现，便于区分两人跨支部同月汇总
    allMode && {
      title: '党支部',
      dataIndex: 'branch',
      width: colW('branch'),
      align: 'center',
      render: (v) => findBranchLabel(v),
    },
    {
      title: '具体岗位',
      dataIndex: 'position',
      width: colW('position'),
      align: 'center',
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <span>{findPositionLabel(v)}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {findLabel(POSITION_TYPES, r.positionType)}
          </span>
        </Space>
      ),
    },
    {
      title: '基础积分',
      dataIndex: 'basic',
      width: colW('basic'),
      align: 'center',
      render: (v) => <span style={{ fontWeight: 600 }}>{v ?? 0}</span>,
    },
    {
      title: '具体事宜',
      dataIndex: 'basicMatters',
      width: colW('basicMatters'), // 只显示「共 N 项」
      align: 'center',
      render: (v) => <MattersCell items={v} />,
    },
    {
      title: '履职贡献积分',
      dataIndex: 'contribution',
      width: colW('contribution'),
      align: 'center',
      render: (v) => <span style={{ fontWeight: 600 }}>{v ?? 0}</span>,
    },
    {
      title: '具体事宜',
      dataIndex: 'contributionMatters',
      width: colW('contributionMatters'), // 只显示「共 N 项」
      align: 'center',
      render: (v) => <MattersCell items={v} />,
    },
    {
      title: '总分',
      dataIndex: 'total',
      width: colW('total'),
      align: 'center',
      render: (v) => (
        <Tag color="volcano" style={{ fontSize: 14, fontWeight: 700 }}>
          {v ?? 0}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: colW('action'),
      align: 'center',
      render: (_, r) => (
        <a onClick={() => setDetail(r)}>
          <EyeOutlined style={{ marginRight: 4 }} />
          查看
        </a>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Space>
          <Text strong>年份</Text>
          <Select
            value={year}
            options={YEAR_OPTIONS}
            onChange={setYear}
            style={{ width: 120 }}
          />
        </Space>
        <Space>
          <Text strong>月份</Text>
          <Select
            value={month}
            options={MONTH_OPTIONS}
            onChange={setMonth}
            style={{ width: 120 }}
          />
        </Space>
        <Tag color="blue">{`${year} 年 ${month} 月`}</Tag>
        <Space>
          <Text strong>支部</Text>
          {/* 组织委员与书记 / 分管领导一样可任选支部或全体（不再锁在本支部） */}
          <Select
            value={branchFilter}
            onChange={setBranchFilter}
            style={{ width: 160 }}
            options={BRANCH_OPTIONS}
          />
        </Space>
        <Tag icon={<TrophyOutlined />} color="gold">
          共 {sorted.length} 人
        </Tag>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!sorted.length || loading}
          onClick={() => {
            try {
              // 全体成员时导出文件不带支部名（如「2026年10月供电服务二中心全体党员月度积分汇总.xlsx」）
              const branchLabel =
                branchFilter === 'all' ? '' : findBranchLabel(branchFilter) || '';
              exportBranchMonthlySummaryToExcel({
                rows: sorted,
                year,
                month,
                branchLabel,
              });
              message.success('已导出 Excel');
            } catch (e) {
              console.error(e);
              message.error(e?.message || '导出失败');
            }
          }}
        >
          导出数据
        </Button>
      </Space>

      {/* ref 用于测量可用宽度（剩余空间平均分给每列） */}
      <div ref={tableWrapRef}>
        <Spin spinning={loading}>
          <Table
            rowKey="workId"
            columns={columns.filter(Boolean)}
            dataSource={sorted}
            pagination={false}
            scroll={{ x: tableScrollX }}
            locale={{ emptyText: <Empty description="本月暂无数据" /> }}
          />
        </Spin>
      </div>

      {/* 单条查看详情：列表里放不下的「具体事宜」在这里展开 */}
      <Modal
        open={!!detail}
        title={detail ? `${detail.name} · ${year} 年 ${month} 月积分明细` : ''}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="姓名">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="工作证编号">{detail.workId}</Descriptions.Item>
            <Descriptions.Item label="党支部" span={2}>
              {findBranchLabel(detail.branch)}
            </Descriptions.Item>
            <Descriptions.Item label="具体岗位" span={2}>
              {findPositionLabel(detail.position)} ·{' '}
              {findLabel(POSITION_TYPES, detail.positionType)}
            </Descriptions.Item>
            <Descriptions.Item label="基础积分">{detail.basic ?? 0}</Descriptions.Item>
            <Descriptions.Item label="履职贡献积分">
              {detail.contribution ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="基础积分具体事宜" span={2}>
              <MattersBlock items={detail.basicMatters} />
            </Descriptions.Item>
            <Descriptions.Item label="履职贡献具体事宜" span={2}>
              {/* 最后一点是审核理由（reviewComment） */}
              <MattersBlock
                items={detail.contributionMatters}
                extraComment={detail.contributionComment}
              />
            </Descriptions.Item>
            <Descriptions.Item label="总分" span={2}>
              <Tag color="volcano" style={{ fontSize: 14, fontWeight: 700 }}>
                {detail.total ?? 0}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </>
  );
}

// ===== 子模块 ②：年度积分汇总 =====
// 口径（后端 /api/summary/annual 已算好）：
//   基础积分     = 当年「有基础积分记录的月份」的平均分（只算已审核）
//   履职贡献积分 = 当年「有履职贡献记录的月份」的平均分（先封顶 40 再平均）
//   年度专项加分 = credit 表当年已审核的 reviewScore
//   年度红线扣分 = discipline 表当年已审核的 reviewScore（通常为负）
//   总分         = 四项相加；按总分降序排名（同分并列，名次跳号）
// 列：排名 / 姓名 /（全体模式：党支部）/ 岗位 / 基础 / 履职 / 专项加分 + 具体事宜 /
//     红线扣分 + 具体事宜 / 总分 / 查看
const ANNUAL_COL_BASE_WIDTHS = {
  rank: 70,
  name: 110,
  branch: 120,
  position: 180,
  basic: 100,
  contribution: 120,
  credit: 120,
  creditMatters: 88,
  discipline: 120,
  disciplineMatters: 88,
  total: 100,
  action: 80,
};
const ANNUAL_COL_KEYS = Object.keys(ANNUAL_COL_BASE_WIDTHS);

function AnnualSummary() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null); // 当前查看的条目
  const [branchFilter, setBranchFilter] = useState(user?.branch || '');

  // 列宽：剩余空间平均分配（与月度汇总同一套做法）
  const tableWrapRef = useRef(null);
  const [tableW, setTableW] = useState(0);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    setTableW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      setTableW(entries[0]?.contentRect?.width || 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const allMode = branchFilter === 'all';
  const activeKeys = allMode
    ? ANNUAL_COL_KEYS
    : ANNUAL_COL_KEYS.filter((k) => k !== 'branch');
  const baseTotal = activeKeys.reduce((s, k) => s + ANNUAL_COL_BASE_WIDTHS[k], 0);
  const extraPerCol =
    tableW > baseTotal ? Math.floor((tableW - baseTotal) / activeKeys.length) : 0;
  const colW = (k) => ANNUAL_COL_BASE_WIDTHS[k] + extraPerCol;
  const tableScrollX = baseTotal + extraPerCol * activeKeys.length;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const data = await getBranchAnnualSummary({
          year,
          branch: branchFilter || undefined,
        });
        if (!cancelled) setRows(Array.isArray(data?.rows) ? data.rows : []);
      } catch (e) {
        if (!cancelled) {
          message.error(e?.message || '加载失败');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, branchFilter]);

  // 后端已按总分降序；这里再排一次并算名次（同分并列，并列后跳号）
  const sorted = useMemo(() => {
    const list = [...rows].sort(
      (a, b) => (b.total || 0) - (a.total || 0) || a.workId.localeCompare(b.workId)
    );
    let rank = 0;
    let prev = null;
    return list.map((r, i) => {
      if (prev === null || r.total !== prev) {
        rank = i + 1;
        prev = r.total;
      }
      return { ...r, rank };
    });
  }, [rows]);

  const columns = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: colW('rank'),
      align: 'center',
      render: (v) => (
        <Tag color={v === 1 ? 'gold' : v <= 3 ? 'volcano' : 'default'}>{v}</Tag>
      ),
    },
    {
      title: '姓名',
      dataIndex: 'name',
      width: colW('name'),
      align: 'center',
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          <span className="muted" style={{ fontSize: 12 }}>{r.workId}</span>
        </Space>
      ),
    },
    allMode && {
      title: '党支部',
      dataIndex: 'branch',
      width: colW('branch'),
      align: 'center',
      render: (v) => findBranchLabel(v),
    },
    {
      title: '具体岗位',
      dataIndex: 'position',
      width: colW('position'),
      align: 'center',
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <span>{findPositionLabel(v)}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {findLabel(POSITION_TYPES, r.positionType)}
          </span>
        </Space>
      ),
    },
    {
      title: '基础积分',
      dataIndex: 'basic',
      width: colW('basic'),
      align: 'center',
      render: (v) => <span style={{ fontWeight: 600 }}>{v ?? 0}</span>,
    },
    {
      title: '履职贡献积分',
      dataIndex: 'contribution',
      width: colW('contribution'),
      align: 'center',
      render: (v) => <span style={{ fontWeight: 600 }}>{v ?? 0}</span>,
    },
    {
      title: '年度专项加分',
      dataIndex: 'creditScore',
      width: colW('credit'),
      align: 'center',
      render: (v) => (
        <span style={{ fontWeight: 600, color: Number(v) > 0 ? '#3f8600' : undefined }}>
          {v ?? 0}
        </span>
      ),
    },
    {
      title: '具体事宜',
      dataIndex: 'creditMatters',
      width: colW('creditMatters'),
      align: 'center',
      render: (v) => <MattersCell items={v} />,
    },
    {
      title: '年度红线扣分',
      dataIndex: 'disciplineScore',
      width: colW('discipline'),
      align: 'center',
      render: (v) => (
        <span style={{ fontWeight: 600, color: Number(v) < 0 ? '#cf1322' : undefined }}>
          {v ?? 0}
        </span>
      ),
    },
    {
      title: '具体事宜',
      dataIndex: 'disciplineMatters',
      width: colW('disciplineMatters'),
      align: 'center',
      render: (v) => <MattersCell items={v} />,
    },
    {
      title: '总分',
      dataIndex: 'total',
      width: colW('total'),
      align: 'center',
      render: (v) => (
        <Tag color="volcano" style={{ fontSize: 14, fontWeight: 700 }}>
          {v ?? 0}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: colW('action'),
      align: 'center',
      render: (_, r) => (
        <a onClick={() => setDetail(r)}>
          <EyeOutlined style={{ marginRight: 4 }} />
          查看
        </a>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Space>
          <Text strong>年度</Text>
          <Select
            value={year}
            options={YEAR_OPTIONS}
            onChange={setYear}
            style={{ width: 120 }}
          />
        </Space>
        <Tag color="blue">{`${year} 年度`}</Tag>
        <Space>
          <Text strong>支部</Text>
          {/* 组织委员与书记 / 分管领导一样可任选支部或全体（不再锁在本支部） */}
          <Select
            value={branchFilter}
            onChange={setBranchFilter}
            style={{ width: 160 }}
            options={BRANCH_OPTIONS}
          />
        </Space>
        <Tag icon={<TrophyOutlined />} color="gold">
          共 {sorted.length} 人
        </Tag>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!sorted.length || loading}
          onClick={() => {
            try {
              const branchLabel =
                branchFilter === 'all' ? '' : findBranchLabel(branchFilter) || '';
              exportBranchAnnualSummaryToExcel({ rows: sorted, year, branchLabel });
              message.success('已导出 Excel');
            } catch (e) {
              console.error(e);
              message.error(e?.message || '导出失败');
            }
          }}
        >
          导出数据
        </Button>
      </Space>

      <div ref={tableWrapRef}>
        <Spin spinning={loading}>
          <Table
            rowKey="workId"
            columns={columns.filter(Boolean)}
            dataSource={sorted}
            pagination={false}
            scroll={{ x: tableScrollX }}
            locale={{ emptyText: <Empty description={`${year} 年度暂无数据`} /> }}
          />
        </Spin>
      </div>

      {/* 单条查看详情：四项分数 + 全部具体事宜（含基础 / 履职贡献的月度明细） */}
      <Modal
        open={!!detail}
        title={detail ? `${detail.name} · ${year} 年度积分明细` : ''}
        onCancel={() => setDetail(null)}
        footer={null}
        width={760}
      >
        {detail && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="姓名">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="工作证编号">{detail.workId}</Descriptions.Item>
            <Descriptions.Item label="党支部" span={2}>
              {findBranchLabel(detail.branch)}
            </Descriptions.Item>
            <Descriptions.Item label="具体岗位" span={2}>
              {findPositionLabel(detail.position)} ·{' '}
              {findLabel(POSITION_TYPES, detail.positionType)}
            </Descriptions.Item>
            <Descriptions.Item label="基础积分（月度平均）">
              {detail.basic ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="履职贡献积分（月度平均）">
              {detail.contribution ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="年度专项加分">
              {detail.creditScore ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label="年度红线扣分">
              {detail.disciplineScore ?? 0}
            </Descriptions.Item>
            {/* 具体事宜只有年度专项加分 / 年度红线扣分两项（前两项是月度平均，不带明细） */}
            <Descriptions.Item label="年度专项加分具体事宜" span={2}>
              <MattersBlock
                items={detail.creditMatters}
                extraComment={detail.creditComment}
              />
            </Descriptions.Item>
            <Descriptions.Item label="年度红线扣分具体事宜" span={2}>
              <MattersBlock items={detail.disciplineMatters} />
            </Descriptions.Item>
            <Descriptions.Item label="总分" span={2}>
              <Tag color="volcano" style={{ fontSize: 14, fontWeight: 700 }}>
                {detail.total ?? 0}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </>
  );
}
