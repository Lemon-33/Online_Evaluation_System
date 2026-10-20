import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import {
  AuditOutlined,
  BellOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  ADMIN_TYPE_SECRETARY,
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { listDisciplines } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../lib/useIsMobile';

// 年度红线扣分审核（党总支书记 admin_type=2 / 支部书记 admin_type=0）
// ------------------------------------------------------------
// 样式 / 交互完全仿照组织委员的「基础积分评价」页：
//   顶部身份 banner + 三张统计卡片 + 筛选区 + 列表 + 「评分 / 查看」按钮
// 与基础积分的差异：
//   - 维度是「年度」（一年一人一条，没有月份）
//   - 分数是扣分（≤ 0），列表里展示成「扣 X 分」
//   - 记录由后端生成：登录 / 启动 / 每 6 小时定时 / 打开本页时惰性补齐
// 可见范围（后端强制）：
//   - 党总支书记 → 全部支部（可跨支部审核）
//   - 支部书记 → 仅自己支部
export default function RedlineReview() {
  const { user } = useAuth();
  const nav = useNavigate();
  // 窄屏：表格横向滚动（列宽是定值，不加会把整个页面撑出横向滚条）
  const isMobile = useIsMobile();
  const isSecretary = user?.adminType === ADMIN_TYPE_SECRETARY;
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('pending'); // 默认「待审核」
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  // 进入页面默认「待审核」；若待审核为 0，自动落到「已审核」（仅首次加载生效，避免手动切换后被抢回）
  const didAutoStatus = useRef(false);

  const yearOptions = useMemo(() => {
    const nowY = new Date().getFullYear();
    const arr = [];
    for (let y = 2026; y <= nowY; y++) arr.push(y);
    return arr.reverse();
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const [data, p, r] = await Promise.all([
        listDisciplines({ year, status, keyword }),
        listDisciplines({ year, status: 'pending' }),
        listDisciplines({ year, status: 'reviewed' }),
      ]);
      // 待审核优先排前面，已审核往后挪
      const sorted = [...data].sort(
        (a, b) =>
          (a.reviewStatus === 'reviewed' ? 1 : 0) -
          (b.reviewStatus === 'reviewed' ? 1 : 0)
      );
      setList(sorted);
      setPendingCount(p.length);
      setReviewedCount(r.length);
      // 首次加载：待审核为 0 时自动切到「已审核」作为默认落点
      if (!didAutoStatus.current) {
        didAutoStatus.current = true;
        if (p.length === 0) setStatus('reviewed');
      }
    } catch (e) {
      console.error(e);
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, status, keyword]);

  // 点击「评分」/「查看 / 重审」：跳到红线扣分问卷页
  const openReview = (rec) => {
    nav(`/redline-review/${rec.id}`, { state: { record: rec } });
  };

  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      width: 110,
      align: 'center',
      render: (v, r) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {r.work_id}
          </span>
        </Space>
      ),
    },
    {
      title: '岗位 / 类型',
      width: 200,
      align: 'center',
      render: (_, r) =>
        `${findPositionLabel(r.position)} / ${findLabel(POSITION_TYPES, r.positionType)}`,
    },
    {
      title: '党支部',
      dataIndex: 'partyBranch',
      width: 140,
      align: 'center',
      render: (v) => findBranchLabel(v),
    },
    {
      title: '年度',
      dataIndex: 'year',
      width: 80,
      align: 'center',
      render: (v) => `${v} 年`,
    },
    {
      title: '扣分',
      dataIndex: 'reviewScore',
      width: 90,
      align: 'center',
      render: (v, r) =>
        r.reviewStatus === 'reviewed' ? (
          <Tag color={Number(v || 0) === 0 ? 'green' : 'red'}>
            {Number(v || 0) === 0 ? '0' : `扣 ${Math.abs(Number(v || 0))} 分`}
          </Tag>
        ) : (
          <span className="muted">-</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'reviewStatus',
      width: 100,
      align: 'center',
      render: (s) =>
        s === 'reviewed' ? <Tag color="green">已审核</Tag> : <Tag color="orange">待审核</Tag>,
    },
    {
      title: '操作',
      width: 120,
      align: 'center',
      render: (_, rec) => (
        <Button type="link" onClick={() => openReview(rec)}>
          {rec.reviewStatus === 'reviewed' ? '查看 / 重审' : '评分'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>年度红线扣分审核</span>
            {/* 党总支书记：可跨支部审核（全部支部）；支部书记：只看自己支部 */}
            <Tag color="gold">
              审核范围：{isSecretary ? '全部支部' : findBranchLabel(user?.branch)}
            </Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片：跟随上方年度筛选 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <BellOutlined />
                  <span>{year} 年待审核</span>
                </Space>
              }
              value={pendingCount}
              suffix="人"
              valueStyle={{ fontSize: 20, color: pendingCount > 0 ? '#cf1322' : '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <CheckCircleOutlined />
                  <span>{year} 年已审核</span>
                </Space>
              }
              value={reviewedCount}
              suffix="人"
              valueStyle={{ fontSize: 20, color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <WarningOutlined />
                  <span>当前列表</span>
                </Space>
              }
              value={list.length}
              suffix="条"
              valueStyle={{ fontSize: 20, color: '#b71c1c' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 筛选区：年度 / 状态 / 按姓名搜索 */}
      <Space style={{ marginBottom: 16 }} size="middle" wrap>
        <span>年度：</span>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 100 }}
          options={yearOptions.map((y) => ({ value: y, label: y }))}
        />
        <span>状态：</span>
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 120 }}
          options={[
            { value: 'pending', label: '待审核' },
            { value: 'reviewed', label: '已审核' },
            { value: '', label: '全部' },
          ]}
        />
        <Input.Search
          placeholder="按姓名搜索"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => setKeyword(v)}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={isMobile ? { x: 'max-content' } : undefined}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="当前筛选条件下暂无记录" /> }}
      />
    </div>
  );
}
