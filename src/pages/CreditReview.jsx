import { useEffect, useMemo, useState } from 'react';
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
  RiseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  ADMIN_TYPE_SECRETARY,
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { listCredits } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

// 年度专项加分审核（支部书记 admin_type=2 / 分管领导 admin_type=0）
// ------------------------------------------------------------
// 模式与「履职贡献评价审核」/「年度红线扣分审核」一致：
//   顶部身份 banner + 三张统计卡片 + 筛选区 + 列表 + 「评分 / 查看 · 重审」按钮
// 与红线审核的差异：
//   - 数据是 credit 表（本人申报，一年一条），**后端不做惰性生成**：
//     该年度没人申报 → 列表就是空的，显示「暂无待审核的专项加分记录」
//   - 分数是加分（≥ 0），列表里展示成「+X 分」
// 可见范围（后端强制）：
//   - 支部书记 → 全部支部（可跨支部审核）
//   - 分管领导 → 仅自己支部
export default function CreditReview() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isSecretary = user?.adminType === ADMIN_TYPE_SECRETARY;
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState(''); // '' = 全部
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);

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
        listCredits({ year, status, keyword }),
        listCredits({ year, status: 'pending' }),
        listCredits({ year, status: 'reviewed' }),
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

  // 空列表文案随筛选状态变化（默认是「待审核优先」的口径）
  const emptyText =
    status === 'reviewed'
      ? `${year} 年暂无已审核的专项加分记录`
      : `${year} 年暂无待审核的专项加分记录`;

  // 点击「评分」/「查看 · 重审」：跳到该条记录的审核页
  const openReview = (rec) => {
    nav(`/credit-review/${rec.id}`, { state: { record: rec } });
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
      title: '加分',
      dataIndex: 'reviewScore',
      width: 90,
      align: 'center',
      render: (v, r) =>
        r.reviewStatus === 'reviewed' ? (
          <Tag color={Number(v || 0) === 0 ? 'default' : 'green'}>
            {Number(v || 0) === 0 ? '0' : `+${Number(v || 0)} 分`}
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
      width: 130,
      align: 'center',
      render: (_, rec) => (
        <Button type="link" onClick={() => openReview(rec)}>
          {rec.reviewStatus === 'reviewed' ? '查看 / 重审' : '审核'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>年度专项加分审核</span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {user?.name}
            </Tag>
            {/* 支部书记：可跨支部审核（全部支部）；分管领导：只看自己支部 */}
            <Tag color="gold">
              审核范围：{isSecretary ? '全部支部' : findBranchLabel(user?.branch)}
            </Tag>
          </Space>
        }
        description="逐条核定党员申报的年度专项加分：给出核定加分与审核意见，提交后计入该年度总分。记录由本人申报产生，当年无人申报时列表为空。"
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片：跟随上方年度筛选 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <BellOutlined />
                  <span>{year} 年待审核</span>
                </Space>
              }
              value={pendingCount}
              suffix="人"
              valueStyle={{ color: pendingCount > 0 ? '#cf1322' : '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <CheckCircleOutlined />
                  <span>{year} 年已审核</span>
                </Space>
              }
              value={reviewedCount}
              suffix="人"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <RiseOutlined />
                  <span>当前列表</span>
                </Space>
              }
              value={list.length}
              suffix="条"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 筛选区：只有年度（无月份）/ 状态 / 按姓名搜索 */}
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
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description={emptyText} /> }}
      />
    </div>
  );
}
