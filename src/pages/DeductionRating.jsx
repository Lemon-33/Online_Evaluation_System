// 基础积分评价 —— 扣分问卷页面（组织委员 adminType=1 专属）
// ---------------------------------------------------------------
// 来源：组织委员在 BasicRating 主界面点击员工后面的「评分」按钮，
// 路由跳到本页面。
//
// 题目呈现：所有题目统一为「填空（每 X 单次扣 Y 分）」形式，
// 仿 src/lib/forms-data.mjs 的 fill(unitScore, unit) 风格。
//   - 默认 0 分（无该问题 → 不扣分）
//   - 组织委员填「次数」/「酌情扣分值」，按 Σ (n × unitScore) 累扣
//
// 计分：
//   - 初始得分 DEDUCTION_BASE_SCORE = 60 分
//   - 最终得分 = max(0, 60 + Σ(n × unitScore))，最低 0 分
//
// 数据落地：
//   - 每道题「次数/扣分值 + 具体事由」-> rating.scores.answers（JSON）
//       形状与履职贡献问卷的填空题一致：answers[key] = { count, reason }
//   - 累加得分 / 总扣分    -> rating.scores.{netScoreDelta,totalDeduction}
//   - 最终得分             -> rating.reviewScore
//   - 整体扣分原因         -> 不再采集（原底部大文本框已取消），reviewComment 固定存空串

import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  message,
  Result,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  MinusCircleOutlined,
  StarFilled,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  DEDUCTION_BASE_SCORE,
  DEDUCTION_SECTIONS,
  deductionFormDefFromSnapshot,
  calcFinalScore,
  calcNetScoreDelta,
  calcTotalDeduction,
  fillCountOf,
  fillReasonOf,
} from '../lib/deduction-form';
import {
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  findBranchLabel,
} from '../lib/constants';
import { listRatings, submitDeductionRating } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

// 答案规范化：统一成 { count, reason }
//   兼容老数据（answers[key] 是直接数字）与缺项（补 { count: 0, reason: '' }）
function normalizeAnswers(raw = {}) {
  const out = {};
  for (const [key, v] of Object.entries(raw || {})) {
    out[key] = {
      count: fillCountOf(v),
      reason: fillReasonOf(v),
    };
  }
  return out;
}

export default function DeductionRating() {
  const { id } = useParams(); // rating.id（URL 最后段）
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // 来源：BasicRating 通过 router state 把整条 record 透传过来
  // 用户直接访问 URL（刷新）时 state 会丢失，则需要重新拉取
  const passedRecord = location.state?.record;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(passedRecord || null);
  // 每道题答案：{ [key]: { count, reason } }
  //   count  = 组织委员填的次数 / 酌情扣分值
  //   reason = 该题具体事由（与履职贡献问卷的填空题一致，一并落库）
  const [answers, setAnswers] = useState(() =>
    normalizeAnswers(passedRecord?.scores?.answers)
  );
  const [submitting, setSubmitting] = useState(false);

  // 加载该条 rating：优先用 router state 透传的 record；
  // state 缺失时（直接刷新或深链）按当前月份+所属支部重新查一次。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (passedRecord) {
        setRecord(passedRecord);
        if (passedRecord.scores && typeof passedRecord.scores === 'object') {
          setAnswers(normalizeAnswers(passedRecord.scores.answers));
        }
        setLoading(false);
        return;
      }
      if (!id) return;
      setLoading(true);
      try {
        const list = await listRatings({
          year: dayjs().year(),
          month: dayjs().month() + 1,
          branch: user?.branch,
        });
        const found = list.find((x) => String(x.id) === String(id));
        if (!cancelled) {
          setRecord(found || null);
          if (found?.scores && typeof found.scores === 'object') {
            setAnswers(normalizeAnswers(found.scores.answers));
          }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) message.error('加载评分记录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 渲染用题集：优先库里 snapshot 还原的「历史题干」（改题后仍原样回显）；
  //   无 snapshot（新记录 / 老快照）→ 当前 deduction-form.js
  // 注意：deductionFormDefFromSnapshot 返回的是 formDef 形状 { sections: [...] }，
  //   与全项目约定一致（见 forms-data.mjs 的 formDefFromSnapshot），
  //   必须取 .sections 才是「题组数组」，直接拿返回值当数组会导致 .flatMap 崩溃
  const sections = useMemo(() => {
    const fd = deductionFormDefFromSnapshot(record?.scores?.snapshot);
    return Array.isArray(fd?.sections) && fd.sections.length
      ? fd.sections
      : DEDUCTION_SECTIONS;
  }, [record]);
  // 拍平题集，供计分 / 提交快照使用（含 sectionTitle，便于下次还原）
  const itemsFlat = useMemo(
    () =>
      (Array.isArray(sections) ? sections : []).flatMap((sec) =>
        (sec.items || []).map((it) => ({ ...it, sectionTitle: sec.title }))
      ),
    [sections]
  );

  // 实时计算（按渲染题集的分值算，保证与所显示的历史题目一致）
  const netScoreDelta = useMemo(
    () => calcNetScoreDelta(answers, itemsFlat),
    [answers, itemsFlat]
  ); // 累加得分（≤ 0）
  const totalDeduction = useMemo(
    () => calcTotalDeduction(answers, itemsFlat),
    [answers, itemsFlat]
  ); // 总扣分（≥ 0）
  const finalScore = useMemo(
    () => calcFinalScore(answers, itemsFlat),
    [answers, itemsFlat]
  ); // 最终得分
  // 是否存在扣分：决定右侧提示文案（每题事由的必填校验见 missingReasonKeys）
  const hasDeduction = totalDeduction > 0;

  // 每道题的「贡献扣分」= 输入次数 × |unitScore|
  const perItemDeduction = (it) =>
    Math.max(0, fillCountOf(answers[it.key]) * Math.abs(it.unitScore || 0));

  // 修改某一题的数量（保留已填的原因）
  const onFill = (key, value) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: { count: value ?? 0, reason: prev?.[key]?.reason ?? '' },
    }));
  };
  // 修改某一题的具体事由（保留已填的数量）
  const onReason = (key, text) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: { count: fillCountOf(prev?.[key]), reason: text ?? '' },
    }));
  };
  // 一键清零：把指定题 / 全题清零（数量与事由一起清）
  const clearOne = (key) =>
    setAnswers((prev) => ({ ...prev, [key]: { count: 0, reason: '' } }));
  const clearAll = () =>
    setAnswers(
      Object.fromEntries(itemsFlat.map((it) => [it.key, { count: 0, reason: '' }]))
    );

  // 提交条件：有扣分（填了次数）的题必须写明该题事由；无扣分可直接提交
  const missingReasonKeys = itemsFlat
    .filter((it) => fillCountOf(answers[it.key]) > 0 && !fillReasonOf(answers[it.key]).trim())
    .map((it) => it.key);
  const canSubmit = !!record && missingReasonKeys.length === 0 && !submitting;

  const onSubmit = async () => {
    if (!record) return;
    if (missingReasonKeys.length > 0) {
      const labels = itemsFlat
        .filter((it) => missingReasonKeys.includes(it.key))
        .map((it) => it.label.slice(0, 12) + '…');
      message.warning(`有 ${missingReasonKeys.length} 道题已扣分但未填写事由：${labels.join('；')}`);
      return;
    }
    setSubmitting(true);
    try {
      // 把每题的扣分方式构造成可读快照，便于审核回放 / 历史题干还原
      //   存的就是「题干 + 填写数量 + 单位/单次分 + 事由 + 该题扣分」
      const snapshot = {};
      itemsFlat.forEach((it) => {
        const v = answers[it.key] || {};
        snapshot[it.key] = {
          sectionTitle: it.sectionTitle,   // 分组用（供"按库里题干回显"还原）
          label: it.label,                 // 题干
          input: fillCountOf(v),           // 组织委员填的次数 / 扣分值
          reason: fillReasonOf(v),         // 该题具体事由
          unit: it.unit,                   // '次' / '分'
          unitScore: it.unitScore,         // 负数：每次扣多少分
          hint: it.hint,                   // 规则补充文案（如累计加倍提示）
          min: it.min ?? 0,
          max: it.max ?? 30,
          deduction: perItemDeduction(it), // 该题实际扣分（正数）
        };
      });
      await submitDeductionRating(record.id, {
        scores: {
          answers,
          snapshot,                  // 完整的「题-选项-扣分」快照
          netScoreDelta,             // 累加得分（负数）
          totalDeduction,            // 累计扣分（正数）
          finalScore,                // 最终得分
          baseScore: DEDUCTION_BASE_SCORE,
        },
        reviewScore: finalScore,
        // 底部「扣分原因」大文本框已取消：整体说明不再采集，
        // 每道题的具体事由写在 scores.answers[key].reason 里，这里固定存空串
        reviewComment: '',
        reviewerName: user?.name || '组织委员',
        // 被评分员工的工号（记录生成时已写入，此处随行携带，
        // 服务端用于兜底回填老记录的空 work_id）
        work_id: record.work_id || '',
      });
      message.success('评分已提交');
      nav('/basic-rating', { replace: true });
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
        title="未找到该条评分记录"
        subTitle="记录可能已被删除，或您无权访问该数据。若您是通过直接打开链接进入，请返回列表页重新点击「评分」"
        extra={
          <Button type="primary" onClick={() => nav('/basic-rating')}>
            返回列表
          </Button>
        }
      />
    );
  }

  const isReviewed = record.reviewStatus === 'reviewed';

  return (
    <div>
      {/* 顶部：返回 + 被评分员工信息 */}
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/basic-rating')}>
          返回
        </Button>
        {Object.values(answers).some((v) => fillCountOf(v) > 0) && (
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
              基础积分评价 —— {record.name}（{record.year} 年 {record.month} 月）
            </span>
            {isReviewed && <Tag color="green">已评分</Tag>}
            {!isReviewed && <Tag color="orange">待评分</Tag>}
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={3} bordered>
          <Descriptions.Item label="姓名">{record.name}</Descriptions.Item>
          <Descriptions.Item label="岗位 / 类型">
            {findPositionLabel(record.position)} / {findLabel(POSITION_TYPES, record.positionType)}
          </Descriptions.Item>
          <Descriptions.Item label="党支部">{findBranchLabel(record.partyBranch)}</Descriptions.Item>
          <Descriptions.Item label="所属月份" span={3}>
            {record.year} 年 {record.month} 月
          </Descriptions.Item>
        </Descriptions>

        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginTop: 12 }}
          message={
            <Space>
              <StarFilled style={{ color: '#faad14' }} />
              <span>
                评分规则：初始得分 <b>{DEDUCTION_BASE_SCORE}</b> 分。所有题目统一为「填空」——
                组织委员填该项问题发生的「{sections[0]?.items[0]?.unit || '次'}」数（或酌情扣分值），
                系统按「次数 × 单次扣分」自动累扣，最终得分最低 0 分。每道题下方还需填写该题的
                <b>具体事由</b>（已扣分的题必填，与履职贡献问卷的填空题一致）。
              </span>
            </Space>
          }
        />
      </Card>

      <Row gutter={16}>
        {/* 左侧：问卷 */}
        <Col span={16}>
          {sections.map((sec) => (
            <Card
              key={sec.title}
              title={sec.title}
              style={{ marginBottom: 16 }}
            >
              {sec.items.map((it, idx) => {
                const v = answers[it.key] || { count: 0, reason: '' };
                const count = fillCountOf(v);
                const deduction = perItemDeduction(it);
                const active = count > 0;
                return (
                  <div
                    key={it.key}
                    style={{
                      marginBottom: idx === sec.items.length - 1 ? 0 : 20,
                      paddingBottom: idx === sec.items.length - 1 ? 0 : 16,
                      borderBottom:
                        idx === sec.items.length - 1
                          ? 'none'
                          : '1px dashed #f0f0f0',
                    }}
                  >
                    {/* 题干 */}
                    <div style={{ fontWeight: 600, marginBottom: 8, lineHeight: 1.7 }}>
                      {idx + 1}. {it.label}
                    </div>

                    {/* 单次扣分说明 + 输入框 + 本题贡献扣分 */}
                    <Space wrap size={12} align="center">
                      <InputNumber
                        min={it.min ?? 0}
                        max={it.max ?? 30}
                        step={1}
                        precision={0}
                        value={count}
                        onChange={(val) => onFill(it.key, val ?? 0)}
                        addonAfter={it.unit}
                        style={{ width: 120 }}
                        placeholder="0"
                        // 仅允许输入非负整数（与 SelfEvaluation 风格一致）
                        parser={(val) =>
                          val === '' || /^\d+$/.test(val) ? val : ''
                        }
                        onKeyDown={(e) => {
                          if (e.ctrlKey || e.metaKey || e.altKey) return;
                          const allowed = new Set([
                            'Backspace', 'Delete', 'Tab', 'Enter',
                            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                            'Home', 'End',
                          ]);
                          if (allowed.has(e.key)) return;
                          if (/^[0-9]$/.test(e.key)) return;
                          e.preventDefault();
                        }}
                        onPaste={(e) => {
                          const text =
                            (e.clipboardData || window.clipboardData)?.getData('text') || '';
                          if (!/^\d+$/.test(text)) e.preventDefault();
                        }}
                      />

                      {/* 该题贡献的扣分 / 提示 */}
                      {active ? (
                        <span style={{ color: '#cf1322', fontWeight: 600 }}>
                          本题扣 {deduction} 分
                        </span>
                      ) : (
                        <span className="muted">本题不扣分</span>
                      )}

                      {/* 一键清零（仅在有值时显示） */}
                      {active && (
                        <Tooltip title="清零本题">
                          <Button
                            type="text"
                            size="small"
                            icon={<MinusCircleOutlined />}
                            onClick={() => clearOne(it.key)}
                          />
                        </Tooltip>
                      )}
                    </Space>

                    {/* 具体事由：与履职贡献问卷的填空题一致，逐题填写并落库
                        （count > 0 时必填，替代原来底部的「扣分原因」大文本框） */}
                    <Input.TextArea
                      rows={2}
                      maxLength={500}
                      showCount
                      style={{ marginTop: 8 }}
                      placeholder={
                        active
                          ? '请填写该题扣分的具体事由（必填）'
                          : '如本题无扣分可留空'
                      }
                      value={fillReasonOf(v)}
                      onChange={(e) => onReason(it.key, e.target.value)}
                    />

                    {/* 规则补充（如 1-2 累计加倍提示） */}
                    {it.hint && (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 6, marginLeft: 4 }}
                      >
                        {it.hint}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          ))}

          <Space>
            <Button onClick={() => nav('/basic-rating')}>取消</Button>
            <Button
              type="primary"
              onClick={onSubmit}
              disabled={!canSubmit}
              loading={submitting}
            >
              {isReviewed ? '更新扣分结果' : '提交扣分结果'}
            </Button>
          </Space>
        </Col>

        {/* 右侧：实时得分卡
            ————————（以下规则仅作为代码注释保留，不在 UI 中展示）————————
            评分规则：每题按「实际 次 数 × 单次扣分」累扣，最低 0 分。
            数据落地：
              - 每题（题干 + 数量 + 具体事由 + 单次扣分 + 该题贡献扣分）→ rating.scores（JSON）
              - 最终得分                                        → rating.reviewScore
              - 整体扣分原因                                     → 不采集，reviewComment = ''
              - 累加得分 / 总扣分 / 基础分                       → rating.scores 内冗余字段
            提交校验：已扣分的题必须填写该题具体事由；无扣分可留空。 */}
        <Col span={8}>
          <Card
            className="score-card"
            title={
              <Space>
                <StarFilled style={{ color: '#faad14' }} />
                <span>实时评分</span>
              </Space>
            }
            style={{ position: 'sticky', top: 16 }}
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
                color: totalDeduction > 0 ? '#cf1322' : '#3f8600',
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
            <Divider style={{ margin: '12px 0' }} />
            {hasDeduction ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                本次存在扣分项，每道已扣分的题都要填写具体事由后才能提交。
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                当前无扣分项，可直接提交。
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
