import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  Radio,
  Result,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import {
  REDLINE_ITEMS,
  REDLINE_NO,
  buildRedlineSnapshot,
  calcRedlineDeduction,
  calcRedlineScore,
  isRedlineHit,
  normalizeRedlineAnswers,
  redlineOptionsOf,
  redlineReasonOf,
} from '../lib/redline-form';
import { listDisciplines, submitDisciplineReview } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;

// 年度红线扣分问卷页（分管领导）
// ------------------------------------------------------------
// 与「基础积分评价」的扣分问卷页同构：左问卷 / 右得分卡。
// 题型差异：这里是「有无」选择题 + 具体事由，而不是填空题数量。
// 计分：选「有」的题按题面分值累计扣分；最终得分 ≤ 0，展示为「扣 X 分」。
// 提交校验：选了「有」的题必须填写具体事由；全部选「无」可直接提交（不扣分）。
// 页面不再采集整体扣分原因 → reviewComment 由后端固定写空串。
export default function RedlineRating() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const passedRecord = loc.state?.record || null;
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(passedRecord || null);
  // 每题答案：{ [key]: { value: 'yes' | 'no', reason } }
  const [answers, setAnswers] = useState(() =>
    normalizeRedlineAnswers(passedRecord?.scores?.answers)
  );
  const [submitting, setSubmitting] = useState(false);

  // 直接打开链接（刷新）导致 state 丢失时，按 id 回查一次
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (passedRecord) {
        setLoading(false);
        return;
      }
      try {
        const all = await listDisciplines({ year: new Date().getFullYear() });
        const found = (all || []).find((x) => String(x.id) === String(id)) || null;
        if (cancelled) return;
        setRecord(found);
        if (found?.scores && typeof found.scores === 'object') {
          setAnswers(normalizeRedlineAnswers(found.scores.answers));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) message.error('加载记录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 最终得分（≤ 0）与扣分合计（正数）
  const finalScore = useMemo(() => calcRedlineScore(answers), [answers]);
  const deduction = useMemo(() => calcRedlineDeduction(answers), [answers]);

  // 修改某题的选择（保留已填事由）
  const onPick = (key, value) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: { value, reason: prev?.[key]?.reason ?? '' },
    }));
  // 修改某题的事由（保留已选选项）
  const onReason = (key, text) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        value: prev?.[key]?.value ?? REDLINE_NO,
        reason: text ?? '',
      },
    }));
  // 一键清零：全部改回「无」并清空事由
  const clearAll = () => setAnswers(normalizeRedlineAnswers({}));

  // 选了「有」但没填事由的题 → 不允许提交
  const missingReasonKeys = REDLINE_ITEMS.filter(
    (it) => isRedlineHit(answers[it.key]) && !redlineReasonOf(answers[it.key]).trim()
  ).map((it) => it.key);
  const canSubmit = !!record && missingReasonKeys.length === 0 && !submitting;

  const onSubmit = async () => {
    if (!record) return;
    if (missingReasonKeys.length > 0) {
      const labels = REDLINE_ITEMS.filter((it) => missingReasonKeys.includes(it.key))
        .map((it) => it.label.slice(0, 12) + '…');
      message.warning(
        `有 ${missingReasonKeys.length} 道题选了「有」但未填写具体事由：${labels.join('；')}`
      );
      return;
    }
    setSubmitting(true);
    try {
      await submitDisciplineReview(record.id, {
        scores: {
          answers,
          snapshot: buildRedlineSnapshot(answers), // 题干 + 选项 + 分值 + 事由
          deduction,   // 扣分合计（正数）
          finalScore,  // 最终得分（负数）
        },
        reviewScore: finalScore,
      });
      message.success('年度红线扣分已提交');
      nav('/redline-review', { replace: true });
    } catch (e) {
      console.error(e);
      message.error(e?.message || '提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  // ----- 渲染 -----
  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin tip="加载中..." />
      </div>
    );
  }

  if (!record) {
    return (
      <Result
        status="warning"
        title="未找到该条年度红线扣分记录"
        subTitle="记录可能已被删除，或您无权访问该数据。若您是通过直接打开链接进入，请返回列表页重新点击「评分」"
        extra={
          <Button type="primary" onClick={() => nav('/redline-review')}>
            返回列表
          </Button>
        }
      />
    );
  }

  const isReviewed = record.reviewStatus === 'reviewed';
  const hitCount = REDLINE_ITEMS.filter((it) => isRedlineHit(answers[it.key])).length;

  return (
    <div>
      {/* 顶部：返回 + 一键清零 */}
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/redline-review')}>
          返回
        </Button>
        {hitCount > 0 && (
          <Button onClick={clearAll} type="dashed">
            一键清零
          </Button>
        )}
      </Space>

      <Card
        title={
          <Space>
            <FileTextOutlined style={{ color: '#b71c1c' }} />
            <span>
              年度红线扣分 —— {record.name}（{record.year} 年）
            </span>
            {isReviewed && <Tag color="green">已审核</Tag>}
            {!isReviewed && <Tag color="orange">待审核</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={3} bordered>
          <Descriptions.Item label="姓名">{record.name}</Descriptions.Item>
          <Descriptions.Item label="岗位 / 类型">
            {findPositionLabel(record.position)} /{' '}
            {findLabel(POSITION_TYPES, record.positionType)}
          </Descriptions.Item>
          <Descriptions.Item label="党支部">
            {findBranchLabel(record.partyBranch)}
          </Descriptions.Item>
          <Descriptions.Item label="年度" span={3}>
            {record.year} 年
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginTop: 12 }}
          message={
            <Space>
              <WarningOutlined style={{ color: '#faad14' }} />
              <span>
                逐项核定：存在的事项选<b>「有」</b>并填写<b>具体事由</b>（必填），
                系统按题面分值累计扣分；不存在选「无」，不扣分。全部为「无」时当年度扣 0 分。
              </span>
            </Space>
          }
        />
      </Card>

      <Row gutter={16}>
        {/* 左侧：问卷 */}
        <Col span={16}>
          <Card title="红线事项核定" style={{ marginBottom: 16 }}>
            {REDLINE_ITEMS.map((it, idx) => {
              const v = answers[it.key] || { value: REDLINE_NO, reason: '' };
              const hit = isRedlineHit(v);
              const reason = redlineReasonOf(v);
              return (
                <div
                  key={it.key}
                  style={{
                    marginBottom: idx === REDLINE_ITEMS.length - 1 ? 0 : 20,
                    paddingBottom: idx === REDLINE_ITEMS.length - 1 ? 0 : 16,
                    borderBottom:
                      idx === REDLINE_ITEMS.length - 1
                        ? 'none'
                        : '1px dashed #f0f0f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Tag color={hit ? 'red' : 'default'} style={{ marginTop: 2 }}>
                      {idx + 1}
                    </Tag>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{it.label}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        分值：{hit ? `扣 ${Math.abs(it.score)} 分` : `选「有」扣 ${Math.abs(it.score)} 分`}
                      </Text>
                      <div style={{ marginTop: 8 }}>
                        <Radio.Group
                          value={v.value || REDLINE_NO}
                          onChange={(e) => onPick(it.key, e.target.value)}
                          optionType="button"
                          buttonStyle="solid"
                          options={redlineOptionsOf(it).map((o) => ({
                            value: o.value,
                            label: o.label,
                          }))}
                        />
                      </div>
                      {hit && (
                        <Input.TextArea
                          rows={2}
                          maxLength={500}
                          showCount
                          style={{ marginTop: 8 }}
                          placeholder="请填写该项的具体事由（必填）"
                          value={reason}
                          onChange={(e) => onReason(it.key, e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        </Col>

        {/* 右侧：得分卡 */}
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
              valueStyle={{ color: deduction > 0 ? '#cf1322' : '#3f8600', fontWeight: 700 }}
            />
            <Divider style={{ margin: '12px 0' }} />
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                命中事项：{hitCount} / {REDLINE_ITEMS.length} 项
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                最终得分：{finalScore}（存入 discipline.reviewScore）
              </Text>
            </Space>
            <Divider style={{ margin: '12px 0' }} />
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button
                type="primary"
                block
                loading={submitting}
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {isReviewed ? '重新提交审核意见' : '提交审核意见'}
              </Button>
              {missingReasonKeys.length > 0 ? (
                <Text type="danger" style={{ fontSize: 12 }}>
                  有 {missingReasonKeys.length} 项选了「有」但未填写具体事由
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  审核人：{user?.name || '分管领导'}
                </Text>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 已审核时的提示（与基础积分评分页保持一致） */}
      {isReviewed && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginTop: 16 }}
          message={`该记录已由 ${record.reviewerName || '分管领导'} 于 ${record.reviewedAt || '-'} 审核，重新提交将覆盖原结果。`}
        />
      )}
    </div>
  );
}
