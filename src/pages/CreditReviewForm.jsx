import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  InputNumber,
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
  EditOutlined,
  FileTextOutlined,
  RiseOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  POSITION_TYPES,
  findBranchLabel,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import {
  CREDIT_COUNT_MAX,
  CREDIT_ITEMS,
  CREDIT_NO,
  CREDIT_SECTIONS,
  CREDIT_YES,
  buildCreditSnapshot,
  calcCreditScore,
  creditCountOf,
  creditOptionsOf,
  creditReasonOf,
  creditValueOf,
  isCreditHit,
  missingCreditReasonKeys,
  normalizeCreditAnswers,
} from '../lib/credit-form';
import { listCredits, submitCreditReview } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;

// 单条年度专项加分审核页（支部书记 / 党总支书记）
// ------------------------------------------------------------
// 从审核列表点「审核」/「查看 · 重审」进入（/credit-review/:id）：
//   ① 左栏就是那张**申报卷子**，但**可编辑** —— 审核人可以改申请人填的选项（有 / 无）、
//      次数，以及每题的具体事由；改动即生效
//   ② 右侧「核定加分」**按卷子内容自动算出**（不再手填数字），实时刷新
//   ③ 末尾「审核意见」框 → 写入 reviewComment
//   ④ 提交 → PATCH /api/credits/:id/review：
//      审核版答案写进 reviewScores 列（员工原始 scores 不动），
//      reviewScore = 自动算出的核定加分，状态置 reviewed
//   ⑤ 员工在「年度专项加分申报」页看到的是**审核后的卷子**（读 reviewScores）
// 题干优先用落库 snapshot（申报当时的题干 + 分值），以后调规则也按当时的样子显示。
export default function CreditReviewForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const passedRecord = loc.state?.record || null;
  const { user } = useAuth();

  const [loading, setLoading] = useState(!passedRecord);
  const [record, setRecord] = useState(passedRecord || null);
  // 审核版答案：已审核过 → 用上次审核定稿；否则用员工申报的答案作为起点
  const [answers, setAnswers] = useState(() =>
    normalizeCreditAnswers(
      passedRecord?.reviewScores?.answers || passedRecord?.scores?.answers
    )
  );
  const [comment, setComment] = useState(passedRecord?.reviewComment || '');
  const [submitting, setSubmitting] = useState(false);

  // 直接打开链接（刷新）导致 state 丢失时，按 id 回查一次（一年一条，从当前年往前找）
  useEffect(() => {
    if (passedRecord) return undefined;
    let cancelled = false;
    (async () => {
      const nowY = new Date().getFullYear();
      try {
        let found = null;
        for (let y = nowY; y >= 2026 && !found; y -= 1) {
          // eslint-disable-next-line no-await-in-loop
          const all = await listCredits({ year: y });
          found = (all || []).find((x) => String(x.id) === String(id)) || null;
        }
        if (cancelled) return;
        setRecord(found);
        if (found) {
          setAnswers(
            normalizeCreditAnswers(found.reviewScores?.answers || found.scores?.answers)
          );
          setComment(found.reviewComment || '');
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

  // 渲染用题目：优先落库 snapshot（申报当时的题干 + 分值），没有则用当前规则
  const sections = useMemo(() => {
    const snap =
      record?.reviewScores?.snapshot || record?.scores?.snapshot;
    if (snap && typeof snap === 'object' && Object.keys(snap).length > 0) {
      return CREDIT_SECTIONS.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => {
          const s = snap[it.key];
          if (!s) return it;
          return {
            ...it,
            label: s.label || it.label,
            score: Number.isFinite(Number(s.score)) ? Number(s.score) : it.score,
            type: s.type === 'count' || s.type === 'bool' ? s.type : it.type,
          };
        }),
      }));
    }
    return CREDIT_SECTIONS;
  }, [record]);

  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const isReviewed = record?.reviewStatus === 'reviewed';
  const selfTotal = Number(record?.selfTotal ?? 0) || 0; // 申请人自报合计

  // 核定加分 = 按卷子内容自动算（审核人改选项 / 次数，这里实时变）
  const reviewScore = useMemo(() => calcCreditScore(answers), [answers]);
  const hitCount = items.filter((it) => isCreditHit(it, answers[it.key])).length;
  const missing = missingCreditReasonKeys(answers);

  // 员工原始答案（用于标出「审核人改了哪些」）
  const origAnswers = useMemo(
    () => normalizeCreditAnswers(record?.scores?.answers || {}),
    [record]
  );

  // ---- 编辑（与申报页同一套交互：0 项 / 选「无」时不显示事由框）----
  const onPick = (key, value) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || {}),
        value,
        count: 0,
        reason: prev?.[key]?.reason ?? '',
      },
    }));
  const onCount = (key, n) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || {}),
        value: CREDIT_NO,
        count: Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0,
        reason: prev?.[key]?.reason ?? '',
      },
    }));
  const onReason = (key, text) =>
    setAnswers((prev) => ({ ...prev, [key]: { ...(prev?.[key] || {}), reason: text ?? '' } }));

  // 该题是否被审核人改过（与员工原始申报对比）
  const changedOf = (key) => {
    const a = answers[key] || {};
    const o = origAnswers[key] || {};
    return (
      creditValueOf(a) !== creditValueOf(o) ||
      creditCountOf(a) !== creditCountOf(o) ||
      creditReasonOf(a) !== creditReasonOf(o)
    );
  };

  const onSubmit = async () => {
    if (!record) return;
    if (missing.length > 0) {
      message.warning(`有 ${missing.length} 项已勾选但未填写具体事由，请补全后再提交`);
      return;
    }
    setSubmitting(true);
    try {
      // 未命中项的残留事由清掉，避免脏数据
      const cleaned = { ...answers };
      for (const it of CREDIT_ITEMS) {
        if (!isCreditHit(it, cleaned[it.key])) {
          cleaned[it.key] = { value: CREDIT_NO, count: 0, reason: '' };
        }
      }
      await submitCreditReview(record.id, {
        scores: { answers: cleaned, snapshot: buildCreditSnapshot(cleaned) },
        reviewScore: calcCreditScore(cleaned), // 按卷子自动算出的核定加分
        reviewComment: comment || '',
      });
      message.success(isReviewed ? '审核意见已更新' : '审核意见已提交');
      nav('/credit-review', { replace: true });
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
        title="未找到该条年度专项加分记录"
        subTitle="记录可能已被删除，或您无权访问该数据。若您是通过直接打开链接进入，请返回列表页重新点击「审核」"
        extra={
          <Button type="primary" onClick={() => nav('/credit-review')}>
            返回列表
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {/* 顶部：返回 + 状态 */}
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/credit-review')}>
          返回
        </Button>
        {isReviewed && <Tag color="green">已审核</Tag>}
        {!isReviewed && <Tag color="orange">待审核</Tag>}
      </Space>

      <Alert
        type="info"
        showIcon
        icon={<EditOutlined />}
        style={{ marginBottom: 16 }}
        message="下方卷子可直接修改：勾选「有 / 无」、填次数、改具体事由。核定加分按您改后的卷子自动计算，无需手填。"
        description={`申请人自报合计 ${selfTotal} 分，仅供参照；最终以您核定的卷子为准。`}
      />

      {/* 申请人信息 */}
      <Card
        title={
          <Space>
            <UserOutlined style={{ color: '#1677ff' }} />
            <span>
              年度专项加分审核 —— {record.name}（{record.year} 年）
            </span>
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
          <Descriptions.Item label="年度">{record.year} 年</Descriptions.Item>
          <Descriptions.Item label="申报时间">{record.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="申请人自报合计">
            <Tag color="blue">{selfTotal} 分</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        {/* 左侧：可编辑的申报卷子 */}
        {/* 窄屏（<768px）左栏整行，右栏（核定加分 / 审核意见）掉到下面 */}
        <Col span={16} xs={24} md={16}>
          {sections.map((sec) => (
            <Card
              key={sec.key}
              title={sec.title}
              style={{ marginBottom: 16 }}
              extra={<Tag color="blue">可修改</Tag>}
            >
              <Alert
                type="info"
                showIcon
                icon={<FileTextOutlined />}
                message={sec.note}
                style={{ marginBottom: 12 }}
              />
              {sec.items.map((it, idx) => {
                const v = answers[it.key] || { value: CREDIT_NO, count: 0, reason: '' };
                const hit = isCreditHit(it, v);
                const isBool = it.type === 'bool';
                const needReason = hit && !creditReasonOf(v).trim();
                const changed = changedOf(it.key);
                return (
                  <div
                    key={it.key}
                    style={{
                      marginBottom: idx === sec.items.length - 1 ? 0 : 18,
                      paddingBottom: idx === sec.items.length - 1 ? 0 : 14,
                      borderBottom:
                        idx === sec.items.length - 1 ? 'none' : '1px dashed #f0f0f0',
                      opacity: hit ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Tag color={hit ? 'green' : 'default'} style={{ marginTop: 2 }}>
                        {idx + 1}
                      </Tag>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, lineHeight: 1.7 }}>
                          {it.label}
                          {changed && (
                            <Tag color="orange" style={{ marginLeft: 8 }}>
                              已修改
                            </Tag>
                          )}
                        </div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          分值：
                          {isBool
                            ? `选「有」加 ${it.score} 分`
                            : `每项 / 每次加 ${it.score} 分${
                                hit
                                  ? `（已填 ${creditCountOf(v)} → 加 ${
                                      creditCountOf(v) * it.score
                                    } 分）`
                                  : ''
                              }`}
                        </Text>
                        <div style={{ marginTop: 8 }}>
                          {isBool ? (
                            <Radio.Group
                              value={creditValueOf(v) || CREDIT_NO}
                              onChange={(e) => onPick(it.key, e.target.value)}
                              optionType="button"
                              buttonStyle="solid"
                              options={creditOptionsOf(it).map((o) => ({
                                value: o.value,
                                label: o.label,
                              }))}
                            />
                          ) : (
                            <Space>
                              <Text type="secondary" style={{ fontSize: 13 }}>
                                次数：
                              </Text>
                              <InputNumber
                                value={creditCountOf(v)}
                                onChange={(n) => onCount(it.key, n)}
                                min={0}
                                max={CREDIT_COUNT_MAX}
                                precision={0}
                                style={{ width: 100 }}
                              />
                            </Space>
                          )}
                        </div>
                        {/* 命中后才显示事由框（审核人可改员工写的内容） */}
                        {hit && (
                          <Input.TextArea
                            rows={2}
                            maxLength={500}
                            showCount
                            style={{ marginTop: 8 }}
                            placeholder={
                              isBool
                                ? '请填写该项的具体事由（必填）'
                                : `请填写这 ${creditCountOf(v)} 项的具体名称 / 时间等（必填）`
                            }
                            value={creditReasonOf(v)}
                            onChange={(e) => onReason(it.key, e.target.value)}
                          />
                        )}
                        {needReason && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            该项已勾选，需填写具体事由后方可提交
                          </Text>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          ))}
        </Col>

        {/* 右侧：自动算出的核定加分 + 审核意见 */}
        <Col span={8} xs={24} md={8}>
          <Card
            title={
              <Space>
                <RiseOutlined style={{ color: '#3f8600' }} />
                <span>加分核定</span>
              </Space>
            }
            style={{ borderColor: '#3f8600' }}
          >
            <Statistic
              title="核定加分（按卷子自动计算）"
              value={reviewScore}
              suffix="分"
              valueStyle={{ color: '#3f8600', fontWeight: 700 }}
            />
            <Divider style={{ margin: '12px 0' }} />
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                申报事项：{hitCount} / {items.length} 项
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                申请人自报：{selfTotal} 分{selfTotal !== reviewScore ? '（本次有调整）' : ''}
              </Text>
            </Space>
            <Divider style={{ margin: '12px 0' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              审核意见（写入 reviewComment）
            </Text>
            <Input.TextArea
              rows={4}
              maxLength={500}
              showCount
              style={{ marginTop: 6 }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="填写审核意见：核定依据、调整或不通过的原因等"
            />
            {/* 提交：未审核 → 提交审核意见；已审核 → 更新审核意见 */}
            <Button
              type="primary"
              block
              style={{ marginTop: 12 }}
              loading={submitting}
              disabled={submitting || missing.length > 0}
              onClick={onSubmit}
            >
              {isReviewed ? '更新审核意见' : '提交审核意见'}
            </Button>
            {missing.length > 0 && (
              <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                有 {missing.length} 项已勾选但未填写具体事由
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              审核人：{user?.name || '-'}
            </Text>
          </Card>
        </Col>
      </Row>

      {/* 已审核时的提示 */}
      {isReviewed && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginTop: 16 }}
          message={`该记录已由 ${record.reviewerName || '审核人'} 于 ${record.reviewedAt || '-'} 审核，重新提交将覆盖原结果。`}
        />
      )}

      <Alert
        type="info"
        showIcon
        icon={<FileTextOutlined />}
        style={{ marginTop: 16 }}
        message="核定后的卷子与加分会回显到员工的「年度专项加分申报」页，并计入其年度总分。"
      />
    </div>
  );
}
