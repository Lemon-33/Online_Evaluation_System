import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Row,
  Col,
  Statistic,
  Tag,
  message,
  Alert,
  Space,
  Divider,
  Radio,
  Descriptions,
  Result,
  Spin,
} from 'antd';
import {
  AuditOutlined,
  ArrowLeftOutlined,
  StarFilled,
  MinusCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import {
  SCORE_DIMENSIONS,
  calcTotal,
  calcGrade,
  calcFormTotal,
  resolveFormDef,
  buildPositionFormSnapshot,
  formDefFromSnapshot,
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  findBranchLabel,
} from '../lib/constants';
import {
  getEvaluationById,
  reviewEvaluation,
  getFormOverride,
} from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

// ============================================================
// 自评审核（整页表单）
// ------------------------------------------------------------
// 从审核列表点「审核」进入（/review-form/:id，按记录 id 定位）：
//   ① 表单按被审核人的岗位（position）渲染，与员工自评界面同构
//   ② 「基础履职 / 提质赋分」两段回显员工原始自评答案（可修改）
//   ③ 「履职扣分」段员工不可见，仅在此处由审核人填写（默认 0 = 不扣）
//   ④ 右侧实时计算总分（含负的扣分项）与扣分小计
//   ⑤ 审核理由：未修改任何选项且无扣分时可留空，否则必填
//   ⑥ 提交 → 服务端存 reviewScores（审核版答案，员工原始 scores 不动）、
//      reviewScore / reviewComment，状态置 reviewed
//   ⑦ 已审核记录可重新进入修改（重审），表单回显上一次审核定稿的答案
// ============================================================
export default function ReviewForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 实际用于渲染的表单定义：优先用库里的 snapshot 还原「历史题干」
  //   （保证审核人看到的题目 = 员工自评时看到的题目，改题后也不错位）
  const [renderFormDef, setRenderFormDef] = useState(null);
  // 被审核人的「个人专属卷子」记录（库里 form_override）；null = 未定制
  const [overrideRec, setOverrideRec] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getEvaluationById(id);
      setRec(r);
      if (!r) return;
      // 表单元定义来源：snapshot（有）优先，否则 库里个人卷子 > 基础模板
      //   —— 「已提交未审核」的记录还没写 snapshot，此时必须拿到该人的个人卷子，
      //      否则审核人看到的题目会和员工填的对不上
      const fdSnapshot = formDefFromSnapshot(
        r.reviewScores?.snapshot || r.scores?.snapshot,
      );
      const ov = await getFormOverride(r.work_id);
      setOverrideRec(ov);
      const fd = fdSnapshot || resolveFormDef(r.position, r.work_id, ov);
      setRenderFormDef(fd);
      if (fd) {
        // 回显基准：重审时优先上一次审核定稿答案，否则用员工原始自评；
        // 履职扣分的填空题员工未作答 → 默认 {count:0, reason:''}（= 不扣分）
        const initial = r.reviewScores?.answers || r.scores?.answers || {};
        const answers = {};
        fd.sections.forEach((sec) =>
          sec.items.forEach((it) => {
            if (it.type === 'fill') {
              const v = initial[it.key];
              // 兼容：旧数据是直接数字，新数据是 {count, reason}
              answers[it.key] =
                v && typeof v === 'object'
                  ? { count: Number(v.count ?? 0), reason: v.reason ?? '' }
                  : { count: Number(v ?? 0), reason: '' };
            } else {
              answers[it.key] = initial[it.key] ?? undefined;
            }
          })
        );
        form.setFieldsValue({ answers, reviewComment: r.reviewComment || '' });
      } else {
        // 通用 5 项表单：无岗位表单的岗位走这里
        const initial = r.reviewScores || r.scores || {};
        const scores = {};
        SCORE_DIMENSIONS.forEach((d) => {
          scores[d.key] = Number(initial[d.key] ?? 0);
        });
        form.setFieldsValue({ scores, reviewComment: r.reviewComment || '' });
      }
    } catch (e) {
      console.error(e);
      message.error(e?.message || '加载自评记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 被审核人岗位对应的专属表单（无则回落通用 5 项）
  //   优先用 snapshot 还原的历史题干（renderFormDef），保证与员工看到的题一致
  const formDef = rec
    ? renderFormDef || resolveFormDef(rec.position, rec.work_id, overrideRec)
    : null;
  const watchedAnswers = Form.useWatch('answers', form) || {};
  const watchedScores = Form.useWatch('scores', form) || {};

  // 实时总分（含负的扣分项）
  const total = formDef
    ? calcFormTotal(formDef, watchedAnswers)
    : calcTotal(watchedScores);

  // 员工原始答案（判断「是否修改过选项」的基准；重审时也与原始比）
  const origAnswers = rec?.scores?.answers || {};
  const origScores = rec?.scores || {};

  // 前两段是否被审核人改过（履职扣分段不参与比较）
  const changed = useMemo(() => {
    if (!rec) return false;
    if (formDef) {
      return formDef.sections
        .filter((sec) => sec.title !== '履职扣分')
        .some((sec) =>
          sec.items.some((it) => {
            const cur = watchedAnswers[it.key];
            const orig = origAnswers[it.key];
            // 填空题兼容 {count, reason} 与老形状（直接数字）
            if (it.type === 'fill') {
              const c = Number(cur?.count ?? cur) || 0;
              const o = Number(orig?.count ?? orig) || 0;
              return c !== o;
            }
            return cur !== orig;
          })
        );
    }
    return SCORE_DIMENSIONS.some(
      (d) =>
        Number(watchedScores[d.key] || 0) !== Number(origScores[d.key] || 0)
    );
  }, [watchedAnswers, watchedScores, rec]);

  // 扣分小计（履职扣分段得分之和，0 或负数）
  const deductSec =
    formDef?.sections.find((sec) => sec.title === '履职扣分') || null;
  const deductScore = deductSec
    ? calcFormTotal({ sections: [deductSec] }, watchedAnswers)
    : 0;

  // 审核理由是否必填：改过选项 或 存在扣分
  const needComment = changed || deductScore < 0;

  const onSubmit = async () => {
    if (!rec) return;
    try {
      const values = await form.validateFields();

      // ---- 主动校验选择题（与自评页一致，绕开 Radio.Group 偶发漏检）----
      const missing = [];
      if (formDef) {
        for (const sec of formDef.sections) {
          for (const it of sec.items) {
            const v = values.answers?.[it.key];
            // 填空题新形状 {count, reason}：只校验 count
            const cnt = it.type === 'fill' ? v?.count ?? v : v;
            const empty =
              cnt === undefined ||
              cnt === null ||
              cnt === '' ||
              (it.type === 'fill' && !Number.isFinite(Number(cnt)));
            if (empty) missing.push(`「${sec.title}」${it.label}`);
          }
        }
      } else {
        for (const d of SCORE_DIMENSIONS) {
          const v = values.scores?.[d.key];
          if (v === undefined || v === null || v === '')
            missing.push(`「${d.label}」`);
        }
      }
      if (missing.length > 0) {
        message.warning(`还有 ${missing.length} 道题未填写：${missing.join('；')}`);
        return;
      }
      // 审核理由规则：改过选项或有扣分 → 必填
      if (needComment && !String(values.reviewComment || '').trim()) {
        message.warning('您修改了自评选项或存在履职扣分，请填写审核理由');
        return;
      }

      setSubmitting(true);
      // 填空题次数为 0 时页面已隐藏原因框 → 提交前清掉残留原因（避免脏数据）
      const answers = formDef
        ? stripEmptyFillReasons(formDef, values.answers || {})
        : null;
      // 审核分 = 当前表单实时总分（含扣分），与右侧展示一致
      const reviewScore = formDef
        ? calcFormTotal(formDef, answers)
        : calcTotal(values.scores);
      await reviewEvaluation(rec.id, {
        scores: formDef
          ? { answers, snapshot: buildPositionFormSnapshot(formDef, answers) }
          : values.scores,
        reviewScore,
        reviewComment: values.reviewComment || '',
        reviewerName: user?.name || '审核人', // 仅 mock 模式生效；真实接口由服务端从 token 绑定
      });
      message.success(
        `审核完成：${rec.name} ${rec.year} 年 ${rec.month || 1} 月 · 最终 ${reviewScore} 分`
      );
      navigate('/review');
    } catch (e) {
      if (e?.errorFields) {
        message.warning('表单还有必填项未完成');
      } else {
        console.error(e);
        message.error(e?.message || '保存失败，请稍后再试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" tip="正在加载自评记录..." />
      </div>
    );
  }

  if (!rec) {
    return (
      <Result
        status="warning"
        title="找不到这条自评记录"
        subTitle="记录可能已被删除，或您没有权限查看"
        extra={
          <Button type="primary" onClick={() => navigate('/review')}>
            返回审核列表
          </Button>
        }
      />
    );
  }

  const reviewed = rec.reviewStatus === 'reviewed';

  return (
    <div>
      {/* 顶部 banner：审核对象信息 */}
      <Alert
        type={reviewed ? 'success' : 'warning'}
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>自评审核</span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {rec.name}
            </Tag>
            <Tag color="purple">
              {findPositionLabel(rec.position)} ·{' '}
              {findLabel(POSITION_TYPES, rec.positionType)}
            </Tag>
            <Tag color="gold">{findBranchLabel(rec.partyBranch)}</Tag>
            <Tag color="blue">
              {rec.year} 年 {rec.month || 1} 月
            </Tag>
            {reviewed ? (
              <Tag color="green" icon={<CheckCircleOutlined />}>
                已审核
              </Tag>
            ) : (
              <Tag color="orange" icon={<ExclamationCircleOutlined />}>
                待审核
              </Tag>
            )}
          </Space>
        }
        description={
          reviewed
            ? `该记录已由 ${rec.reviewerName || '审核人'} 于 ${rec.reviewedAt || '-'} 审核得 ${rec.reviewScore} 分。您可以修改后重新提交，本次提交将覆盖上一次审核结果。`
            : '前两部分已按员工自评答案填入，可修改；「履职扣分」部分由您填写，右侧实时计算最终审核分。'
        }
        style={{ marginBottom: 16 }}
      />

      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={16}>
            {formDef ? (
              // 岗位专属表单：与员工自评界面同构，三段全部展示
              formDef.sections.map((sec) => {
                const isDeduct = sec.title === '履职扣分';
                return (
                  <Card
                    key={sec.title}
                    style={{
                      marginTop: 16,
                      borderColor: isDeduct ? '#ffa39e' : undefined,
                    }}
                    title={
                      <Space>
                        {isDeduct && (
                          <MinusCircleOutlined style={{ color: '#cf1322' }} />
                        )}
                        <span>{sec.title}</span>
                      </Space>
                    }
                    extra={
                      isDeduct ? (
                        <Tag color="red">审核人填写</Tag>
                      ) : (
                        <Tag color="default">员工自评</Tag>
                      )
                    }
                  >
                    {sec.items.map((it, idx) => (
                      <div
                        key={it.key}
                        style={{
                          marginBottom:
                            idx === sec.items.length - 1 ? 0 : 20,
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>
                          {idx + 1}. {it.label}
                          {it.type === 'fill' && (
                            <span
                              className="muted"
                              style={{ marginLeft: 8, fontSize: 12 }}
                            >
                              （每{it.unit}{' '}
                              {it.unitScore > 0 ? '+' : ''}
                              {it.unitScore} 分）
                            </span>
                          )}
                        </div>
                        {it.type === 'fill' ? (
                          // 填空题：次数为 0 时不显示原因框，填了次数才出现（且必填）
                          <FillAnswerItem it={it} isDeduct={isDeduct} />
                        ) : (
                          <Form.Item
                            name={['answers', it.key]}
                            rules={[{ required: true, message: '请选择一个选项' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Radio.Group>
                              <Space direction="vertical">
                                {it.options.map((o) => (
                                  <Radio key={o.value} value={o.value}>
                                    {o.label}
                                    <span
                                      className="muted"
                                      style={{ marginLeft: 8, fontSize: 12 }}
                                    >
                                      {o.score === 0
                                        ? '不加分'
                                        : `${o.score > 0 ? '+' : ''}${o.score} 分`}
                                    </span>
                                  </Radio>
                                ))}
                              </Space>
                            </Radio.Group>
                          </Form.Item>
                        )}
                      </div>
                    ))}
                  </Card>
                );
              })
            ) : (
              // 通用 5 项表单（岗位未配置专属表单时）
              <Card title="分项审核（总分 100）" style={{ marginTop: 16 }}>
                {SCORE_DIMENSIONS.map((d) => (
                  <Row
                    key={d.key}
                    gutter={16}
                    align="middle"
                    style={{ marginBottom: 12 }}
                  >
                    <Col span={6}>
                      <div style={{ fontWeight: 600 }}>{d.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {d.desc}
                      </div>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name={['scores', d.key]}
                        rules={[
                          { required: true, message: '请打分' },
                          {
                            type: 'number',
                            min: 0,
                            max: d.max,
                            message: `0 - ${d.max} 分`,
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          max={d.max}
                          step={1}
                          style={{ width: '100%' }}
                          addonAfter={`/ ${d.max}`}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <InputNumber
                        min={0}
                        max={d.max}
                        step={1}
                        value={Math.round(
                          ((watchedScores?.[d.key] || 0) / d.max) * 100
                        )}
                        formatter={(v) => `${v || 0}%`}
                        parser={(v) => v?.replace('%', '') || 0}
                        disabled
                        style={{ width: '100%' }}
                      />
                    </Col>
                  </Row>
                ))}
              </Card>
            )}
          </Col>

          <Col span={8}>
            {/* 被审核人信息 */}
            <Card title="被审核人">
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="姓名">{rec.name}</Descriptions.Item>
                <Descriptions.Item label="党支部">
                  {findBranchLabel(rec.partyBranch)}
                </Descriptions.Item>
                <Descriptions.Item label="岗位 / 类型">
                  {findPositionLabel(rec.position)} /{' '}
                  {findLabel(POSITION_TYPES, rec.positionType)}
                </Descriptions.Item>
                <Descriptions.Item label="评价周期">
                  {rec.year} 年 {rec.month || 1} 月
                </Descriptions.Item>
                <Descriptions.Item label="员工自评分">
                  <Tag color="blue">{rec.selfTotal}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="提交时间">
                  {rec.createdAt}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* 实时审核总分 */}
            <Card
              className="score-card"
              style={{ marginTop: 16 }}
              title={
                <Space>
                  <StarFilled style={{ color: '#faad14' }} />
                  <span>审核总分（实时）</span>
                </Space>
              }
            >
              <Statistic
                value={total}
                valueStyle={{ color: '#b71c1c', fontSize: 36 }}
              />
              {!formDef && (
                <div style={{ marginTop: 8 }}>
                  <Tag color="green" style={{ fontSize: 14, padding: '2px 10px' }}>
                    {calcGrade(total)}
                  </Tag>
                </div>
              )}
              <Divider style={{ margin: '12px 0' }} />
              <div className="muted" style={{ fontSize: 12 }}>
                = 基础履职 + 提质赋分 + 履职扣分（负数）
              </div>
            </Card>

            {/* 扣分小计（岗位表单专属） */}
            {deductSec && (
              <Card style={{ marginTop: 16, borderColor: '#ffa39e' }}>
                <Statistic
                  title={
                    <Space>
                      <MinusCircleOutlined style={{ color: '#cf1322' }} />
                      <span>履职扣分小计</span>
                    </Space>
                  }
                  value={deductScore}
                  suffix="分"
                  valueStyle={{
                    color: deductScore < 0 ? '#cf1322' : '#3f8600',
                  }}
                />
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {deductScore < 0
                    ? '存在扣分项，审核理由必填'
                    : '暂无扣分'}
                </div>
              </Card>
            )}

            {/* 审核理由 + 提交 */}
            <Card
              title="审核理由"
              style={{ marginTop: 16 }}
              extra={
                needComment ? (
                  <Tag color="red">必填</Tag>
                ) : (
                  <Tag color="default">可留空</Tag>
                )
              }
            >
              <Form.Item
                name="reviewComment"
                style={{ marginBottom: 12 }}
                rules={[
                  {
                    required: needComment,
                    whitespace: true,
                    message: '您修改了自评选项或存在扣分，请填写审核理由',
                  },
                ]}
              >
                <Input.TextArea
                  rows={4}
                  showCount
                  placeholder={
                    needComment
                      ? '检测到您修改了选项或存在扣分，请说明理由'
                      : '未修改任何选项且无扣分时可留空'
                  }
                />
              </Form.Item>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Button
                  type="primary"
                  block
                  size="large"
                  loading={submitting}
                  onClick={onSubmit}
                  icon={<AuditOutlined />}
                >
                  {reviewed ? '重新提交审核意见' : '提交审核意见'}
                </Button>
                <Button block icon={<ArrowLeftOutlined />} onClick={() => navigate('/review')}>
                  返回审核列表
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  );
}

// ============================================================
// 填空题渲染：次数 + 具体事由
// ------------------------------------------------------------
// 与自评页 / 年度专项加分申报同一套交互：**次数为 0 时不显示原因框**，
// 填了次数才出现（且必填），避免留下"有数量、没事由"的记录。
// 抽成组件是因为要用 Form.useWatch 实时监听次数（hook 不能写在 .map 里）。
// ============================================================
function FillAnswerItem({ it, isDeduct }) {
  const form = Form.useFormInstance();
  const watched = Form.useWatch(['answers', it.key, 'count'], form);
  const n = Number(watched) || 0;
  const needReason = it.hasReason !== false && n > 0;
  return (
    <>
      <Form.Item
        name={['answers', it.key, 'count']}
        rules={[
          { required: true, message: '请输入数量' },
          { type: 'number', min: 0, max: 30, message: '请输入 0-30 的整数' },
        ]}
        style={{ marginBottom: needReason ? 8 : 0 }}
      >
        <InputNumber
          min={0}
          max={30}
          step={1}
          precision={0}
          keyboard={false}
          style={{ width: 120 }}
          placeholder="请输入数量"
          addonAfter={it.unit}
          parser={(v) => (v === '' || /^\d+$/.test(v) ? v : '')}
          onKeyDown={(e) => {
            // 只允许数字与编辑键（与自评页一致）
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
      </Form.Item>
      {/* 次数 > 0 才显示原因框（次数归零时自动隐藏） */}
      {needReason && (
        <Form.Item
          name={['answers', it.key, 'reason']}
          style={{ marginBottom: 0 }}
          rules={[{ required: true, message: '请填写具体事由' }]}
          extra={
            <span className="muted" style={{ fontSize: 12 }}>
              {/* 原因框可编辑：审核人可以修改员工填写的内容。
                  履职扣分：员工自评页看不到这一段，原因由审核人填写；
                  前两部分：框里是员工自评写的得分原因，审核人可修改。 */}
              {isDeduct
                ? '请填写扣分具体事由（该题由您填写）'
                : '员工自评填写的得分原因，审核人可修改'}
            </span>
          }
        >
          <Input.TextArea
            rows={2}
            maxLength={500}
            showCount
            placeholder={isDeduct ? '请填写扣分具体事由' : '（员工未填写原因）'}
          />
        </Form.Item>
      )}
    </>
  );
}

// 提交前清理：填空题次数为 0 时，把残留的原因清空（页面已隐藏该框，避免脏数据）
function stripEmptyFillReasons(formDef, answers = {}) {
  const out = { ...answers };
  (formDef?.sections || []).forEach((sec) =>
    sec.items.forEach((it) => {
      if (it.type === 'fill' && Number(out[it.key]?.count ?? 0) === 0) {
        out[it.key] = { count: 0, reason: '' };
      }
    })
  );
  return out;
}
