import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Statistic, Tag, Typography, Spin, Alert } from 'antd';
import {
  LineChartOutlined,
  CalendarOutlined,
  RiseOutlined,
  FallOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../context/AuthContext';
import { getMemberMonthlyScores, getMemberAnnualScores } from '../lib/cloudbase';

// 月度下拉：1-12 + "全年"
const MONTH_OPTIONS = [
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` })),
  { value: 'all', label: '全年' },
];

// 年度下拉：2026 起 5 年回看（最新在前）；员工 / 管理员都能查历史
const currentYear = dayjs().year();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => ({
  value: y,
  label: `${y} 年`,
}));

const { Title, Text } = Typography;

export default function ScoreQuery() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(dayjs().month() + 1); // 默认当月
  const [loading, setLoading] = useState(false);
  const [monthly, setMonthly] = useState(null);   // { basic, contribution, total } | null
  const [annual, setAnnual] = useState(null);     // { basicAvg, contributionAvg, credit, discipline, total } | null
  const [error, setError] = useState('');

  // 切到「全年」时把月选择也保留在全年上以保持 UI 一致
  const isAll = month === 'all';

  // 自动查询：year / month 变化时重新拉
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        if (isAll) {
          const a = await getMemberAnnualScores({
            year,
            workId: user.workId,
            name: user.name,
          });
          if (!cancelled) {
            setAnnual(a);
            setMonthly(null);
          }
        } else {
          const m = await getMemberMonthlyScores({
            year,
            month: Number(month),
            workId: user.workId,
            name: user.name,
          });
          if (!cancelled) {
            setMonthly(m);
            setAnnual(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || '查询失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, user, isAll]);

  const rangeLabel = useMemo(
    () => (isAll ? `${year} 年（全年）` : `${year} 年 ${month} 月`),
    [year, month, isAll]
  );

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />
        个人积分查询
      </Title>
      <Text type="secondary">
        查看本人 {rangeLabel} 的基础积分、履职贡献积分与年度加减分明细。数据来自已审核记录，
        未审核或无记录一律按 0 分显示。
      </Text>

      <Card style={{ marginTop: 16 }}>
        <Space size={16} wrap>
          <Space>
            <CalendarOutlined />
            <Text strong>年度</Text>
            <Select
              value={year}
              options={YEAR_OPTIONS}
              onChange={setYear}
              style={{ width: 120 }}
            />
          </Space>
          <Space>
            <Text strong>月度</Text>
            <Select
              value={month}
              options={MONTH_OPTIONS}
              onChange={setMonth}
              style={{ width: 120 }}
            />
          </Space>
          <Tag color="blue">{rangeLabel}</Tag>
        </Space>
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="查询失败"
          description={error}
        />
      )}

      <Spin spinning={loading} style={{ marginTop: 16 }}>
        {isAll ? (
          <AnnualView data={annual} />
        ) : (
          <MonthlyView data={monthly} />
        )}
      </Spin>
    </div>
  );
}

// 月度视图：3 张卡（基础 / 履职贡献 / 总分）
function MonthlyView({ data }) {
  if (!data) return null;
  return (
    <Row gutter={16} style={{ marginTop: 8 }}>
      <Col xs={24} sm={8}>
        <Card>
          <Statistic
            title="当月基础积分"
            value={data.basic}
            precision={2}
            suffix="分"
            valueStyle={{ color: '#1677ff' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            
          </Text>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card>
          <Statistic
            title="当月履职贡献积分"
            value={data.contribution}
            precision={2}
            suffix="分"
            valueStyle={{ color: '#13c2c2' }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            
          </Text>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card style={{ borderColor: '#1677ff' }}>
          <Statistic
            title="当月总分"
            value={data.total}
            precision={2}
            suffix="分"
            prefix={<TrophyOutlined />}
            valueStyle={{ color: '#cf1322', fontWeight: 700 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            基础积分 + 履职贡献积分
          </Text>
        </Card>
      </Col>
    </Row>
  );
}

// 全年视图：5 张卡（月度基础平均 / 月度履职贡献平均 / 创新加分 / 红线扣分 / 总分）
function AnnualView({ data }) {
  if (!data) return null;
  const {
    basicAvg = 0,
    contributionAvg = 0,
    credit = 0,
    discipline = 0,
    total = 0,
  } = data;
  return (
    <>
      <Row gutter={16} style={{ marginTop: 8 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="月度基础积分平均分"
              value={basicAvg}
              precision={2}
              suffix="分"
              valueStyle={{ color: '#1677ff' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              查到的月份均分（缺月不计入）
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="月度履职贡献积分平均分"
              value={contributionAvg}
              precision={2}
              suffix="分"
              valueStyle={{ color: '#13c2c2' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              查到的月份均分（缺月不计入）
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="年度创新争先总加分"
              value={credit}
              precision={2}
              suffix="分"
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="年度红线总扣分"
              value={discipline}
              precision={2}
              suffix="分"
              prefix={<FallOutlined />}
              valueStyle={{ color: discipline < 0 ? '#cf1322' : '#8c8c8c' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              
            </Text>
          </Card>
        </Col>
      </Row>
      <Card style={{ marginTop: 16, borderColor: '#1677ff' }}>
        <Statistic
          title="年度总分"
          value={total}
          precision={2}
          suffix="分"
          prefix={<TrophyOutlined />}
          valueStyle={{ color: '#cf1322', fontWeight: 700 }}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          月度基础平均 + 月度履职贡献平均 + 创新加分 + 红线扣分
        </Text>
      </Card>
    </>
  );
}
