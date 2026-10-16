import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  RiseOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { POSITION_TYPES, findLabel, findPositionLabel } from '../lib/constants';
import {
  CREDIT_COUNT_MAX,
  CREDIT_ITEMS,
  CREDIT_NO,
  CREDIT_SECTIONS,
  CREDIT_YES,
  calcCreditScore,
  creditOptionsOf,
  creditReasonOf,
  creditValueOf,
  creditCountOf,
  buildCreditSnapshot,
  isCreditHit,
  missingCreditReasonKeys,
  normalizeCreditAnswers,
} from '../lib/credit-form';
import { getMyCredit, submitCreditApply } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;

// 年度专项加分申报（员工本人，一年一次）
// ------------------------------------------------------------
// 与「每月履职贡献自评」同构（左申报卷 / 右合计卡），差异：
//   - **没有月历**：顶部只有年份选项（一年申报一次）
//   - 题型两种：不带"每项 / 每次"的条款 → 「有无 + 事由」；带的 → 「次数 + 事由」
//   - 提交走 PUT /api/credits/mine（按 work_id + year 覆盖更新），
//     不做惰性生成 —— 没申报过就没有记录
// 已审核后整份表单锁定只读（题干用落库 snapshot 回显），需要修改请审核人重新核定
export default function CreditApply() {
  const { user } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  // 返回：从「个人积分查询 / 党员自我评价提交」进来 → 退回上一页；
  // 直接刷新打开（没有上一步）→ 回提交类工作总入口
  const goBack = () => (loc.key && loc.key !== 'default' ? nav(-1) : nav('/self-center'));
  const nowY = new Date().getFullYear();
  // 从「个人积分查询 → 全年 → 年度专项加分 → 提交 / 更新 / 查看」进来时带上所查年度，
  // 直接落到那一年（个人积分查询是年度口径，链接和查看的必须是同一年）
  const [year, setYear] = useState(Number(loc.state?.year) || nowY);
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [answers, setAnswers] = useState(() => normalizeCreditAnswers({}));
  const [submitting, setSubmitting] = useState(false);

  const yearOptions = useMemo(() => {
    const arr = [];
    for (let y = 2026; y <= nowY; y++) arr.push(y);
    return arr.reverse();
  }, [nowY]);

  // 切年份 / 首次进入：拉本人该年申报记录（没申报过 = null，表单保持空白）
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rec = await getMyCredit({ year });
        if (cancelled) return;
        setRecord(rec || null);
        // 已审核 → 回显**审核人核定后的卷子**（reviewScores）；
        // 未审核 / 无审核版 → 回显本人申报（scores.answers）
        const src =
          rec?.reviewStatus === 'reviewed' && rec?.reviewScores?.answers
            ? rec.reviewScores.answers
            : rec?.scores?.answers;
        setAnswers(normalizeCreditAnswers(src));
      } catch (e) {
        console.error(e);
        if (!cancelled) message.error(e?.message || '加载申报记录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, user]);

  // 渲染用题目：已审核时用落库快照还原「历史题干 + 分值」（以后调规则也不会变），
  // 未审核 / 未提交则用当前规则（用户还在填，必须是最新题）
  // 已审核时优先用**审核版**快照（审核人看到的题干与分值）
  const sections = useMemo(() => {
    const snap =
      (record?.reviewStatus === 'reviewed' && record?.reviewScores?.snapshot) ||
      record?.scores?.snapshot;
    if (record?.reviewStatus === 'reviewed' && snap && typeof snap === 'object') {
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
  const locked = isReviewed; // 已审核 → 只读（显示审核结果）
  // 本人原始申报（已审核时用于对照标出「审核人改了哪些」）
  const origAnswers = useMemo(
    () => normalizeCreditAnswers(record?.scores?.answers || {}),
    [record]
  );
  // 该题是否被审核人改过（选项 / 次数 / 事由任一不同）
  const reviewChangedOf = (it, v) => {
    const o = origAnswers[it.key] || {};
    return (
      creditValueOf(v) !== creditValueOf(o) ||
      creditCountOf(v) !== creditCountOf(o) ||
      creditReasonOf(v) !== creditReasonOf(o)
    );
  };

  const selfTotal = useMemo(() => calcCreditScore(answers), [answers]);
  const hitCount = items.filter((it) => isCreditHit(it, answers[it.key])).length;
  const missing = missingCreditReasonKeys(answers);
  const canSubmit = !locked && !submitting && missing.length === 0;

  // 改 bool 题的选择（保留已填事由）
  const onPick = (key, value) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: { ...(prev?.[key] || {}), value, reason: prev?.[key]?.reason ?? '' },
    }));
  // 改 count 题的次数（保留已填事由）
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
  // 改事由
  const onReason = (key, text) =>
    setAnswers((prev) => ({
      ...prev,
      [key]: { ...(prev?.[key] || {}), reason: text ?? '' },
    }));

  const onSubmit = async () => {
    if (missing.length > 0) {
      message.warning(
        `有 ${missing.length} 项已申报但未填写具体事由，请补全后再提交`
      );
      return;
    }
    setSubmitting(true);
    try {
      // 未申报（0 项 / 选「无」）的题页面已隐藏原因框 → 提交前清掉残留，避免脏数据
      const cleaned = { ...answers };
      for (const it of CREDIT_ITEMS) {
        if (!isCreditHit(it, cleaned[it.key])) {
          cleaned[it.key] = { value: CREDIT_NO, count: 0, reason: '' };
        }
      }
      await submitCreditApply({
        year,
        scores: {
          answers: cleaned,
          snapshot: buildCreditSnapshot(cleaned), // 题干 + 分值 + 答案 + 事由
          selfTotal,
        },
        selfTotal,
      });
      message.success(`${year} 年度专项加分申报已提交，等待审核`);
      // 回查一次拿到最新状态（提交后记录才存在 / 状态刷新）
      const rec = await getMyCredit({ year });
      setRecord(rec || null);
    } catch (e) {
      console.error(e);
      message.error(e?.message || '提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* 顶部 banner：年份是唯一的时间维度（一年申报一次，没有月历） */}
      <Alert
        type="info"
        showIcon
        icon={<UserOutlined />}
        message={
          <Space wrap>
            <span style={{ fontWeight: 600 }}>年度专项加分申报</span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {user?.name}
            </Tag>
            <Tag color="purple">
              {findPositionLabel(user?.position)} · {findLabel(POSITION_TYPES, user?.positionType)}
            </Tag>
          </Space>
        }
        description="按年度申报本人获得的荣誉表彰、创新创效、急难险重任务与示范引领类加分事项；同一事项获不同级别表彰的，只按最高级别申报。"
        style={{ marginBottom: 16 }}
      />

      {/* 年份选择（没有月份、没有月历） */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Space wrap>
            <Text strong>申报年度：</Text>
            <Select
              value={year}
              onChange={setYear}
              style={{ width: 120 }}
              options={yearOptions.map((y) => ({ value: y, label: `${y} 年` }))}
            />
            {record && (
              <Tag color={isReviewed ? 'green' : 'orange'}>
                {isReviewed ? '已审核' : '已提交待审核'}
              </Tag>
            )}
            {!record && !loading && <Tag>尚未申报</Tag>}
          </Space>
          {/* 返回：回到进来时的那一页 */}
          <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
        </div>
      </Card>

      {/* 已审核提示 */}
      {isReviewed && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 16 }}
          message={`${year} 年度专项加分已由 ${record.reviewerName || '审核人'} 于 ${record.reviewedAt || '-'} 核定：${Number(record.reviewScore || 0)} 分`}
          description={
            record.reviewComment
              ? `审核意见：${record.reviewComment}`
              : '申报内容已锁定；如需修改请联系审核人。'
          }
        />
      )}

      <Spin spinning={loading}>
        <Row gutter={16}>
          {/* 左侧：申报卷（按四类分组） */}
          <Col span={16}>
            {sections.map((sec) => (
              <Card
                key={sec.key}
                title={sec.title}
                style={{ marginBottom: 16 }}
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {sec.items.length} 项
                  </Text>
                }
              >
                <Alert
                  type="info"
                  showIcon
                  icon={<InfoCircleOutlined />}
                  message={sec.note}
                  style={{ marginBottom: 12 }}
                />
                {sec.items.map((it, idx) => {
                  const v = answers[it.key] || { value: CREDIT_NO, count: 0, reason: '' };
                  const hit = isCreditHit(it, v);
                  const isBool = it.type === 'bool';
                  const needReason = hit && !creditReasonOf(v).trim();
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
                            {/* 已审核：标出审核人改过哪些（与本人申报对比） */}
                            {isReviewed && reviewChangedOf(it, v) && (
                              <Tag color="orange" icon={<AuditOutlined />} style={{ marginLeft: 8 }}>
                                审核人修改
                              </Tag>
                            )}
                          </div>
                          {/* 被改过的题给出「本人申报」对照，便于核对 */}
                          {isReviewed && reviewChangedOf(it, v) && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              本人申报：
                              {it.type === 'bool'
                                ? isCreditHit(it, origAnswers[it.key])
                                  ? '有'
                                  : '无'
                                : `${creditCountOf(origAnswers[it.key])} 项 / 次`}
                            </Text>
                          )}
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            分值：
                            {isBool
                              ? `选「有」加 ${it.score} 分`
                              : `每项 / 每次加 ${it.score} 分${
                                  hit ? `（已填 ${creditCountOf(v)} → 加 ${creditCountOf(v) * it.score} 分）` : ''
                                }`}
                          </Text>
                          <div style={{ marginTop: 8 }}>
                            {isBool ? (
                              <Radio.Group
                                value={creditValueOf(v) || CREDIT_NO}
                                onChange={(e) => onPick(it.key, e.target.value)}
                                optionType="button"
                                buttonStyle="solid"
                                disabled={locked}
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
                                  disabled={locked}
                                  style={{ width: 100 }}
                                />
                              </Space>
                            )}
                          </div>
                          {/* 命中后必须写事由（具体项目 / 时间 / 佐证） */}
                          {hit && (
                            <Input.TextArea
                              rows={2}
                              maxLength={500}
                              showCount
                              style={{ marginTop: 8 }}
                              disabled={locked}
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
                              该项已申报，需填写具体事由后方可提交
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

          {/* 右侧：合计卡（未审核 = 自报合计；已审核 = 核定加分） */}
          <Col span={8}>
            <Card
              title={
                <Space>
                  <RiseOutlined style={{ color: '#3f8600' }} />
                  <span>{isReviewed ? '核定加分' : '自报合计'}</span>
                </Space>
              }
              style={{ borderColor: '#3f8600' }}
            >
              <Statistic
                title={
                  isReviewed ? `${year} 年核定加分（审核后）` : `${year} 年申报加分（自报）`
                }
                value={isReviewed ? Number(record.reviewScore || 0) : selfTotal}
                suffix="分"
                valueStyle={{ color: '#3f8600', fontWeight: 700 }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {isReviewed && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    本人申报合计：{selfTotal} 分
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {isReviewed ? '核定' : '申报'}事项：{hitCount} / {items.length} 项
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {isReviewed
                    ? '下方卷子为审核人核定后的结果'
                    : '最终加分以审核人核定结果为准'}
                </Text>
              </Space>
              <Divider style={{ margin: '12px 0' }} />
              <Button
                type="primary"
                block
                loading={submitting}
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {locked ? '已审核，不可修改' : record ? '重新提交申报' : '提交申报'}
              </Button>
              {missing.length > 0 ? (
                <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  有 {missing.length} 项已申报但未填写具体事由
                </Text>
              ) : (
                <Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginTop: 8 }}
                >
                  {locked
                    ? '如需修改请联系审核人'
                    : '提交后可在审核完成前反复修改（覆盖更新）'}
                </Text>
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}
