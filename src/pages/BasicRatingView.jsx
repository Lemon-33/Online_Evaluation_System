// 基础积分评价查看（员工只读浏览）
// ------------------------------------------------------------
// 数据源：rating 表（由组织委员 / 支部书记填写）
// 问卷内容：DEDUCTION_SECTIONS 扣分问卷（同组织委员那边的题目）
// 仅做"自己 / 自己当月" 的只读展示：题目 + 审核人选项 + 最终得分，
// 不允许修改。未来的月份不可选。
// 与「月度履职贡献自评」的差异：
//   - 模式标记为「浏览模式」而非「党员自评模式」
//   - 已审核提示简化为「本次评价已由 {reviewerName} 完成，最终审核分为 {reviewScore} 分，如需复核请联系所属支部管理员」
//   - 不显示「自评内容已锁定」「审核人修改了 N 处选项」等自评相关文案
//   - 数据表来自 rating（不是 evaluation），表单是 DEDUCTION_SECTIONS（不是岗位专属 3 段）
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Input,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined,
  StarFilled,
  WarningOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  DEDUCTION_BASE_SCORE,
  DEDUCTION_ITEMS_FLAT,
  DEDUCTION_SECTIONS,
  calcFinalScore,
  calcNetScoreDelta,
  calcTotalDeduction,
} from '../lib/deduction-form';
import {
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  findBranchLabel,
} from '../lib/constants';
import { getMyRating } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function BasicRatingView() {
  const { user } = useAuth();
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [loading, setLoading] = useState(false);
  // 当月记录：{ id, scores, reviewStatus, reviewScore, reviewerName, reviewComment, ... } | null
  const [record, setRecord] = useState(null);
  // 当年所有月份记录（用于月历）：[{ month, reviewStatus, reviewScore }, ...]
  const [yearList, setYearList] = useState([]);

  // 未来月份：不可选 / 不可点
  const isFutureMonth = (y, m) => {
    const now = dayjs();
    return y > now.year() || (y === now.year() && m > now.month() + 1);
  };
  // 评价周期从 2026 年起；最多到当前年
  const years = useMemo(() => {
    const now = dayjs().year();
    const arr = [];
    for (let y = 2026; y <= now; y++) arr.push(y);
    return arr.reverse();
  }, []);

  // 月历：{ [month]: { reviewStatus, reviewScore } }
  const monthMap = useMemo(() => {
    const m = {};
    yearList.forEach((r) => {
      m[r.month || 1] = { reviewStatus: r.reviewStatus, reviewScore: r.reviewScore };
    });
    return m;
  }, [yearList]);

  // 加载数据：当月 + 当年所有
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [one, all] = await Promise.all([
          getMyRating({ year, month }),
          getMyRating({ year }),
        ]);
        if (!cancelled) {
          setRecord(one || null);
          setYearList(Array.isArray(all) ? all : []);
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e?.message || '加载失败');
          setRecord(null);
          setYearList([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, user]);

  // 解析扣分问卷答案（不修改，只是展示）
  const answers = useMemo(
    () => (record?.scores && typeof record.scores === 'object' ? record.scores.answers : null) || {},
    [record]
  );

  // 优先用服务端落地的统计字段；老数据或无 record 时按 answers 重算
  const totalDeduction =
    (record?.scores && typeof record.scores === 'object' && record.scores.totalDeduction) ??
    calcTotalDeduction(answers);
  const finalScore =
    record?.reviewScore != null
      ? Number(record.reviewScore)
      : record?.scores?.finalScore != null
      ? Number(record.scores.finalScore)
      : calcFinalScore(answers);

  const isReviewed = record?.reviewStatus === 'reviewed';
  const hasDeduction = totalDeduction > 0;

  return (
    <div>
      {/* 顶部 banner：浏览模式（不是「自评模式」） */}
      <Alert
        type="info"
        showIcon
        icon={<EyeOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>浏览模式</span>
            <Tag color="blue">{user?.name}</Tag>
            <Tag color="purple">
              {findPositionLabel(user?.position)} · {findLabel(POSITION_TYPES, user?.positionType)}
            </Tag>
          </Space>
        }
        description="您只能查看自己的评价记录，无法访问其他党员的信息。"
        style={{ marginBottom: 16 }}
      />

      {/* 年份 + 月份切换（与自评页风格保持一致：年份按钮组 + 月历格子） */}
      <Space style={{ marginBottom: 16 }} wrap>
        <span>评价年度：</span>
        <Space.Compact>
          {years.map((y) => (
            <Button
              key={y}
              type={y === year ? 'primary' : 'default'}
              onClick={() => setYear(y)}
            >
              {y}
            </Button>
          ))}
        </Space.Compact>
        <span>月份在右侧月历中选择：</span>
        {isReviewed && <Tag color="green" icon={<CheckCircleOutlined />}>已评分</Tag>}
        {record && !isReviewed && <Tag color="orange" icon={<ExclamationCircleOutlined />}>待评分</Tag>}
        {!record && !isFutureMonth(year, month) && <Tag>无记录</Tag>}
        {isFutureMonth(year, month) && <Tag>未来月份</Tag>}
      </Space>

      {/* 已审核/未审核状态提示（简化的文案，不含「自评内容已锁定」「修改了 N 处」等自评术语） */}
      {isReviewed && (
        <Alert
          showIcon
          type="success"
          icon={<TrophyOutlined />}
          style={{ marginBottom: 16 }}
          message={`本次评价已由 ${record.reviewerName || '管理员'} 完成，最终审核分为 ${record.reviewScore} 分，如需复核请联系所属支部管理员`}
        />
      )}
      {!isReviewed && record && !isFutureMonth(year, month) && (
        <Alert
          showIcon
          type="info"
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="本月基础积分尚未完成评分"
          description="组织委员评分完成后将在这里显示最终得分与扣分明细。"
        />
      )}
      {!record && !isFutureMonth(year, month) && (
        <Alert
          showIcon
          type="warning"
          style={{ marginBottom: 16 }}
          message={`${year} 年 ${month} 月暂无基础积分评价记录`}
          description="通常由组织委员在新月份开始时自动生成，请联系所属支部组织委员确认。"
        />
      )}

      <Spin spinning={loading}>
        <Row gutter={16}>
          {/* 左：员工/岗位信息 + 扣分问卷（只读） */}
          <Col span={16}>
            {record && (
              <Card style={{ marginBottom: 16 }}>
                <Descriptions size="small" column={3} bordered>
                  <Descriptions.Item label="姓名">{record.name}</Descriptions.Item>
                  <Descriptions.Item label="岗位 / 类型">
                    {findPositionLabel(record.position)} / {findLabel(POSITION_TYPES, record.positionType)}
                  </Descriptions.Item>
                  <Descriptions.Item label="党支部">
                    {findBranchLabel(record.partyBranch)}
                  </Descriptions.Item>
                  <Descriptions.Item label="所属月份" span={3}>
                    {record.year} 年 {record.month} 月
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            )}

            {record ? (
              <ReadOnlyDeduct answers={answers} />
            ) : (
              !isFutureMonth(year, month) && (
                <Card>
                  <Empty description="该月份暂无基础积分评价记录" />
                </Card>
              )
            )}

            {/* 审核理由（评分时填写的扣分原因） */}
            {isReviewed && record?.reviewComment && (
              <Card title="评分说明" style={{ marginTop: 16 }}>
                <Input.TextArea
                  rows={3}
                  value={record.reviewComment}
                  readOnly
                  style={{ background: 'transparent' }}
                />
              </Card>
            )}
          </Col>

          {/* 右：月历（顶部） + 最终评分（下方，sticky 固定） */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <CalendarOutlined style={{ color: '#1677ff' }} />
                  <span>{year} 年基础积分月历</span>
                </Space>
              }
            >
              <div className="mini-cal">
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const info = monthMap[m];
                  const st = info?.reviewStatus;
                  const future = isFutureMonth(year, m);
                  const cls = [
                    'mini-cal-cell',
                    st === 'reviewed' ? 'is-done' : st === 'pending' ? 'is-pending' : '',
                    future ? 'is-future' : '',
                    m === month ? 'is-cur' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const tip = future
                    ? `${m} 月：未来月份，不可查看`
                    : st === 'reviewed'
                    ? `${m} 月：已评分 ${info?.reviewScore ?? ''} 分`
                    : st === 'pending'
                    ? `${m} 月：待评分`
                    : `${m} 月：暂无记录`;
                  return (
                    <Tooltip key={m} title={tip}>
                      <div className={cls} onClick={() => !future && setMonth(m)}>
                        {m}月
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="mini-cal-legend">
                <span><i className="dot dot-done" />已评分</span>
                <span><i className="dot dot-pending" />待评分</span>
                <span><i className="dot dot-free" />暂无</span>
                <span><i className="dot dot-future" />不可选</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                未来月份不可查看；只能选择已生成记录的月份
              </div>
            </Card>

            <Card
              className="score-card"
              style={{ marginTop: 16, position: 'sticky', top: 16 }}
              title={
                <Space>
                  <StarFilled style={{ color: '#faad14' }} />
                  <span>最终评分</span>
                </Space>
              }
            >
              <Statistic
                title={`基础分（${DEDUCTION_BASE_SCORE} 分）`}
                value={DEDUCTION_BASE_SCORE}
                valueStyle={{ color: '#1677ff', fontSize: 24 }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Statistic
                title="累计扣分"
                value={totalDeduction}
                suffix="分"
                valueStyle={{
                  color: hasDeduction ? '#cf1322' : '#3f8600',
                  fontSize: 24,
                }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Statistic
                title="最终得分"
                value={finalScore}
                suffix={`/ ${DEDUCTION_BASE_SCORE}`}
                valueStyle={{
                  color: finalScore >= DEDUCTION_BASE_SCORE * 0.75 ? '#3f8600' : '#cf1322',
                  fontSize: 36,
                }}
              />
              {isReviewed && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 8 }}>
                  评分人：{record.reviewerName || '组织委员'} ·{' '}
                  {record.reviewedAt ? dayjs(record.reviewedAt).format('YYYY-MM-DD HH:mm') : ''}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

// 只读扣分问卷：题目 + 审核人填的次数/扣分值 + 该题贡献的扣分；
// 没有扣分的题目淡灰显示，>0 的题目红色高亮
function ReadOnlyDeduct({ answers }) {
  const perItemDeduction = (it) => {
    const v = answers?.[it.key];
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n * Math.abs(it.unitScore || 0));
  };
  return (
    <>
      {DEDUCTION_SECTIONS.map((sec) => (
        <Card
          key={sec.title}
          title={
            <Space>
              <WarningOutlined style={{ color: '#fa541c' }} />
              <span>{sec.title}</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {sec.items.map((it, idx) => {
            const v = answers?.[it.key] ?? 0;
            const deduction = perItemDeduction(it);
            const active = Number(v) > 0;
            const absScore = Math.abs(it.unitScore || 0);
            return (
              <div
                key={it.key}
                style={{
                  marginBottom: idx === sec.items.length - 1 ? 0 : 20,
                  paddingBottom: idx === sec.items.length - 1 ? 0 : 16,
                  borderBottom:
                    idx === sec.items.length - 1 ? 'none' : '1px dashed #f0f0f0',
                  opacity: active ? 1 : 0.55,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, lineHeight: 1.7 }}>
                  {idx + 1}. {it.label}
                </div>
                <Space wrap size={12} align="center">
                  <Tag color="red" style={{ fontSize: 13, padding: '2px 10px' }}>
                    每 {it.unit} 扣 {absScore} 分
                  </Tag>
                  <Tag color={active ? 'volcano' : 'default'} style={{ fontSize: 13 }}>
                    审核人填写：{v} {it.unit}
                  </Tag>
                  {active ? (
                    <span style={{ color: '#cf1322', fontWeight: 600 }}>
                      本题扣 {deduction} 分
                    </span>
                  ) : (
                    <span className="muted">本题不扣分</span>
                  )}
                </Space>
                {it.hint && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6, marginLeft: 4 }}>
                    {it.hint}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      ))}
    </>
  );
}
