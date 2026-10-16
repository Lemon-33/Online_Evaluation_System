import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Tag,
  Button,
  Space,
  Statistic,
  Empty,
  Card,
  Row,
  Col,
  Select,
  Input,
  Alert,
  message,
} from 'antd';
import {
  StarOutlined,
  BellOutlined,
  CheckCircleOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  ADMIN_TYPE_SECRETARY,
  findLabel,
  findPositionLabel,
  POSITION_TYPES,
  findBranchLabel,
  ROLES, // 本文件 isSuperAdmin 仍在用旧 role 字段判断，必须导入（否则 ReferenceError）
} from '../lib/constants';
import { listRatings } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

// 基础积分评价页（组织委员 adminType=1 专属）
// 筛选模块与「管理员审核」页保持一致：年度 / 月份 / 状态 / 按姓名搜索
// - 每条记录由后端在新月份到来时自动生成（全默认值，reviewScore=0）
// - 月份选「全年」时不带 month 参数，按年度汇总查看
export default function BasicRating() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(''); // '' = 全年，1-12 = 指定月份
  const [status, setStatus] = useState(''); // '' = 全部
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);

  // 组织委员只负责本支部
  // 支部书记（adminType=2）的 branch 为空 → 查全支部
  const scopeBranch = user?.branch;
  const isSuperAdmin = user?.role === ROLES.ADMIN && user?.adminType === 2;

  // 年份选项：2026 起至当前年（最近的排前面）
  const yearOptions = useMemo(() => {
    const nowY = new Date().getFullYear();
    const arr = [];
    for (let y = 2026; y <= nowY; y++) arr.push(y);
    return arr.reverse();
  }, []);

  // 筛选范围描述，用于统计卡片标题（如「2026 年 3 月」「2026 年」）
  const scopeLabel = month ? `${year} 年 ${month} 月` : `${year} 年`;

  const reload = async () => {
    setLoading(true);
    try {
      const scope = { year, month, branch: scopeBranch };
      // 三份数据并行：当前筛选 + 该范围内的待审核 / 已审核人数（不受状态切换影响）
      const [data, p, r] = await Promise.all([
        listRatings({ ...scope, status, keyword }),
        listRatings({ ...scope, status: 'pending' }),
        listRatings({ ...scope, status: 'reviewed' }),
      ]);
      // 排序：待审核的排前面优先处理，已审核的往后挪（各自内部保持原有顺序）
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
  }, [year, month, status, keyword, scopeBranch]);

  // 点击「评分」/「查看 / 重审」：跳转到扣分问卷页
  // 通过 location.state 把整条 record 透传过去，避免在 DeductionRating 里再次拉取
  // 若用户直接刷新问卷页导致 state 丢失，由该页兜底为「请回到列表页」。
  const openReview = (rec) => {
    nav(`/basic-rating/deduct/${rec.id}`, { state: { record: rec } });
  };


  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    { title: '姓名', dataIndex: 'name', width: 110, align: 'center' },
    {
      title: '岗位 / 类型',
      width: 200,
      align: 'center',
      render: (_, r) =>
        `${findPositionLabel(r.position)} / ${findLabel(POSITION_TYPES, r.positionType)}`,
    },
    {
      title: '月份',
      dataIndex: 'month',
      width: 70,
      align: 'center',
      render: (v) => `${v || 1} 月`,
    },
    {
      title: '党支部',
      dataIndex: 'partyBranch',
      width: 140,
      align: 'center',
      render: (v) => findBranchLabel(v),
    },
    {
      title: '审核分',
      dataIndex: 'reviewScore',
      width: 90,
      align: 'center',
      render: (v) => <Tag color="blue">{v ?? 0}</Tag>,
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
      {/* 顶部 banner：标明身份与数据范围（组织委员 / 支部书记） */}
      <Alert
        type={isSuperAdmin ? 'error' : 'warning'}
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>
              {isSuperAdmin ? '支部书记评分模式' : '组织委员基础积分评分'}
            </span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {user?.name}
            </Tag>
            <Tag color={isSuperAdmin ? 'magenta' : 'gold'}>
              {isSuperAdmin
                ? '可见全支部'
                : `负责评分：${findBranchLabel(scopeBranch)}`}
            </Tag>
          </Space>
        }
        description={
          isSuperAdmin
            ? '您作为支部书记可查看所有支部的基础积分记录；编辑评分请走对应的扣分问卷页。'
            : `您负责给「${findBranchLabel(
                scopeBranch
              )}」的党员进行基础积分评分。`
        }
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片：跟随上方筛选范围（全年 / 指定月份） */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <BellOutlined />
                  <span>{scopeLabel}待审核</span>
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
                  <span>{scopeLabel}已审核</span>
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
                  <StarOutlined />
                  <span>当前列表</span>
                </Space>
              }
              value={list.length}
              suffix="条"
              valueStyle={{ color: '#b71c1c' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 筛选区：年度 / 月份 / 状态 / 按姓名搜索（与「管理员审核」页一致） */}
      <Space style={{ marginBottom: 16 }} size="middle" wrap>
        <span>年度：</span>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 100 }}
          options={yearOptions.map((y) => ({ value: y, label: y }))}
        />
        <span>月份：</span>
        <Select
          value={month}
          onChange={setMonth}
          style={{ width: 100 }}
          options={[
            { value: '', label: '全年' },
            ...Array.from({ length: 12 }, (_, i) => ({
              value: i + 1,
              label: `${i + 1} 月`,
            })),
          ]}
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
        locale={{ emptyText: <Empty description="当前筛选条件下暂无记录" /> }}
        pagination={{ pageSize: 10 }}
      />

      {/* 评分按钮：通过路由跳转至 src/pages/DeductionRating 扣分问卷页 */}
    </div>
  );
}
