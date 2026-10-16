import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import {
  REDLINE_ITEMS,
  REDLINE_NO,
  isRedlineHit,
  normalizeRedlineAnswers,
  redlineReasonOf,
  redlineValueOf,
} from '../lib/redline-form';
import { getMyDiscipline } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

// 年度红线扣分详情（党员只读浏览自己某一年的红线卷子）
// ------------------------------------------------------------
// 数据源：discipline 表（人 × 年，由分管领导 / 支部书记核定）
// 与「基础积分评价详情」同构（左卷子 / 右扣分卡、顶部返回 + banner + 状态提示），
// 差异只在：这是**年度**口径（无月份），分数是纯扣分（≤ 0，展示为「扣 X 分」）。
// 入口：个人积分查询 → 全年 → 「年度红线总扣分」卡片下方「查看评价」
//   → /redline-view/:year（年度由上游确定，页面不提供选年）
// 渲染优先用落库快照 snapshot（改题后仍原样回显历史题干），无快照再按当前题集 + answers 还原。
export default function RedlineView() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { year: pYear } = useParams();
  const year = Number(pYear) || new Date().getFullYear(); // 参数缺失兜底当前年

  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const one = await getMyDiscipline({ year });
        if (!cancelled) setRecord(one || null);
      } catch (e) {
        if (!cancelled) {
          message.error(e?.message || '加载失败');
          setRecord(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, user]);

  // 渲染用题目：优先快照（历史题干 + 当时分值 + 事由 + 该题扣分），否则按 answers 还原
  const items = useMemo(() => {
    const snap = record?.scores?.snapshot;
    if (snap && typeof snap === 'object') {
      return REDLINE_ITEMS.map((it) => {
        const s = snap[it.key] || {};
        const hit = s.value === 'yes';
        return {
          key: it.key,
          label: s.label || it.label,
          value: s.value || REDLINE_NO,
          reason: s.reason || '',
          hit,
          deduction: hit ? Math.abs(s.score ?? it.score ?? 0) : 0,
        };
      });
    }
    const answers = normalizeRedlineAnswers(record?.scores?.answers);
    return REDLINE_ITEMS.map((it) => {
      const v = answers[it.key] || {};
      const hit = isRedlineHit(v);
      return {
        key: it.key,
        label: it.label,
        value: redlineValueOf(v),
        reason: redlineReasonOf(v),
        hit,
        deduction: hit ? Math.abs(it.score || 0) : 0,
      };
    });
  }, [record]);

  // 扣分合计：优先落库值（deduction / |reviewScore|），否则按当前答案重算
  const deduction =
    (record?.scores && typeof record.scores === 'object' && record.scores.deduction) ??
    (record?.reviewScore != null ? Math.abs(Number(record.reviewScore)) : 0);
  // 命中项的「第 N 项」序号（1 起，按卷子里的题号）
  const hitIndexes = items.map((it, i) => (it.hit ? i + 1 : 0)).filter(Boolean);
  const hitCount = hitIndexes.length;
  const isReviewed = record?.reviewStatus === 'reviewed';

  // 「涉及事项」文案：写出来具体是第几项，而不是只报数量
  //   0 项 → 不涉及；1 项 → 第 X 项；2 项 → 第 X 项和第 Y 项；
  //   3 项及以上 → 前面用顿号、最后两项之间用「和」（第 X 项、第 Y 项和第 Z 项）
  const involvedText = useMemo(() => {
    if (!hitCount) return '不涉及';
    const arr = hitIndexes.map((n) => `第 ${n} 项`);
    if (hitCount === 1) return arr[0];
    if (hitCount === 2) return `${arr[0]}和${arr[1]}`;
    return `${arr.slice(0, -1).join('、')}和${arr[hitCount - 1]}`;
  }, [hitIndexes, hitCount]);

  return (
    <div>
      {/* 顶部返回入口：年度由「个人积分查询」确定，本页不选年 */}
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/score-query')}>
          返回个人积分查询
        </Button>
        {isReviewed && <Tag color="green" icon={<CheckCircleOutlined />}>已核定</Tag>}
        {record && !isReviewed && <Tag color="orange" icon={<InfoCircleOutlined />}>待核定</Tag>}
        {!record && <Tag>无记录</Tag>}
      </Space>

      {/* 顶部 banner：浏览模式，标题直接带上年度 */}
      <Alert
        type="info"
        showIcon
        icon={<EyeOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>年度红线扣分详情 · {year} 年</span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {user?.name}
            </Tag>
            <Tag color="purple">
              {findPositionLabel(user?.position)} · {findLabel(POSITION_TYPES, user?.positionType)}
            </Tag>
          </Space>
        }
        description="您只能查看自己的年度红线扣分记录，无法访问其他党员的信息。"
        style={{ marginBottom: 16 }}
      />

      {/* 状态提示（与「基础积分评价详情」同风格） */}
      {isReviewed && (
        <Alert
          showIcon
          type={deduction > 0 ? 'warning' : 'success'}
          icon={deduction > 0 ? <WarningOutlined /> : <CheckCircleOutlined />}
          style={{ marginBottom: 16 }}
          message={`本年度红线事项已由 ${record.reviewerName || '分管领导'} 核定，${
            deduction > 0 ? `共扣 ${deduction} 分` : '未发现红线事项，扣 0 分'
          }，如需复核请联系所属支部管理员`}
        />
      )}
      {!isReviewed && record && (
        <Alert
          showIcon
          type="info"
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="本年度红线事项尚未完成核定"
          description="分管领导 / 支部书记核定完成后，将在这里显示扣分明细与具体事由。"
        />
      )}
      {!record && (
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 16 }}
          message={`${year} 年暂无您的年度红线扣分记录`}
          description="该记录按年度自动生成（本人不在被评范围内则不会生成），如有疑问请联系所属支部管理员。"
        />
      )}

      <Spin spinning={loading}>
        <Row gutter={16}>
          {/* 左：人员信息 + 红线卷子（只读） */}
          <Col span={16}>
            {record && (
              <Card style={{ marginBottom: 16 }}>
                <Descriptions size="small" column={3} bordered>
                  <Descriptions.Item label="姓名">{record.name}</Descriptions.Item>
                  <Descriptions.Item label="岗位 / 类型">
                    {findPositionLabel(record.position)} /{' '}
                    {findLabel(POSITION_TYPES, record.positionType)}
                  </Descriptions.Item>
                  <Descriptions.Item label="党支部">
                    {findBranchLabel(record.partyBranch)}
                  </Descriptions.Item>
                  <Descriptions.Item label="所属年度" span={3}>
                    {record.year} 年
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            )}

            {record ? (
              <ReadOnlyRedline items={items} />
            ) : (
              <Card>
                <Empty description="该年度暂无年度红线扣分记录" />
              </Card>
            )}
          </Col>

          {/* 右：扣分卡 */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <WarningOutlined style={{ color: '#faad14' }} />
                  <span>扣分合计</span>
                </Space>
              }
              style={{ borderColor: '#faad14' }}
            >
              <Statistic
                title="当年度红线扣分"
                value={deduction}
                suffix="分"
                valueStyle={{
                  color: deduction > 0 ? '#cf1322' : '#3f8600',
                  fontSize: 28,
                  fontWeight: 700,
                }}
              />
              <Divider style={{ margin: '12px 0' }} />
              {/* 涉及事项：具体写出第几项（多项用顿号 + 末尾「和」连接），不报数量 */}
              <Statistic
                title="涉及事项"
                value={involvedText}
                valueStyle={{
                  color: hitCount > 0 ? '#cf1322' : '#3f8600',
                  fontSize: hitCount > 2 ? 16 : 22,
                  fontWeight: 700,
                  lineHeight: 1.5,
                }}
              />
              {isReviewed && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 8 }}>
                  核定人：{record.reviewerName || '分管领导'} ·{' '}
                  {record.reviewedAt || ''}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

// 只读红线卷子：题目 + 审核人选择（有 / 无）+ 具体事由 + 该题扣分；
// 未命中的题目淡灰显示，命中的红色高亮
function ReadOnlyRedline({ items = [] }) {
  return (
    <Card title="红线事项核定">
      {items.map((it, idx) => (
        <div
          key={it.key}
          style={{
            marginBottom: idx === items.length - 1 ? 0 : 20,
            paddingBottom: idx === items.length - 1 ? 0 : 16,
            borderBottom: idx === items.length - 1 ? 'none' : '1px dashed #f0f0f0',
            opacity: it.hit ? 1 : 0.55,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, lineHeight: 1.7 }}>
            {idx + 1}. {it.label}
          </div>
          <Space wrap size={12} align="center">
            <Tag color={it.hit ? 'red' : 'default'} style={{ fontSize: 13 }}>
              审核人核定：{it.hit ? '有' : '无'}
            </Tag>
            {it.hit ? (
              <span style={{ color: '#cf1322', fontWeight: 600 }}>
                本题扣 {it.deduction} 分
              </span>
            ) : (
              <span style={{ color: 'rgba(0,0,0,0.45)' }}>本题不扣分</span>
            )}
          </Space>
          {/* 该题具体事由（审核人填写；为空时整块不显示） */}
          {it.reason ? (
            <div style={{ fontSize: 13, marginTop: 8, marginLeft: 4 }}>
              <span style={{ color: 'rgba(0,0,0,0.45)' }}>具体事由：</span>
              <span style={{ color: 'rgba(0,0,0,0.85)' }}>{it.reason}</span>
            </div>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
