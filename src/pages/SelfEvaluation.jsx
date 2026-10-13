import { useEffect, useMemo, useState } from 'react';
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
  Empty,
  Divider,
  Select,
  Radio,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  TrophyOutlined,
  StarFilled,
  CalendarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SCORE_DIMENSIONS,
  calcTotal,
  calcGrade,
  calcFormTotal,
  calcFormGrade,
  getPositionForm,
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { getMyEvaluation, submitSelfEvaluation, listEvaluations } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function SelfEvaluation() {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [existing, setExisting] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [scores, setScores] = useState({});
  const [loaded, setLoaded] = useState(false);
  // 月历数据：{ [月份]: reviewStatus }，记录当年各月是否已提交
  const [monthRecords, setMonthRecords] = useState({});

  // 提交时间不允许晚于当前月份（如今天是 2026-10-13，则 2026-11 及以后不可选）
  const isFutureMonth = (y, m) => {
    const now = dayjs();
    return y > now.year() || (y === now.year() && m > now.month() + 1);
  };

  // 评价周期从 2026 年开始；未来年份不允许提交，因此最多到当前年
  const years = useMemo(() => {
    const now = dayjs().year();
    const arr = [];
    for (let y = 2026; y <= now; y++) arr.push(y);
    return arr.reverse(); // 最近的年份排前面
  }, []);

  const reload = async (y, m) => {
    if (!user?.name) return;
    // 并行取两份数据：当前月的记录 + 当年全部记录（供月历展示）
    const [rec, all] = await Promise.all([
      getMyEvaluation(user.name, y, m),
      listEvaluations({ year: y, keyword: user.name }),
    ]);
    setExisting(rec);
    // keyword 是模糊搜索（"张三"可能搜到"张三丰"），需精确过滤本人
    const byMonth = {};
    all
      .filter((x) => x.name === user.name)
      .forEach((x) => {
        byMonth[x.month || 1] = x.reviewStatus;
      });
    setMonthRecords(byMonth);
    if (rec) {
      // 兼容两种历史数据：岗位表单（scores.answers）与通用 5 项（直接分值）
      form.setFieldsValue({
        partyBranch: user?.branch || rec.partyBranch || '',
        scores: rec.scores?.answers ? {} : rec.scores || {},
        answers: rec.scores?.answers || {},
      });
      setScores(rec.scores?.answers ? {} : rec.scores || {});
    } else {
      form.setFieldsValue({
        partyBranch: user?.branch || '',
        scores: {},
        answers: {},
      });
      setScores({});
    }
    setLoaded(true);
  };

  useEffect(() => {
    reload(year, month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, user]);

  // 岗位专属表单（有配置则用选择题模式，没有则走通用 5 项打分）
  const formDef = getPositionForm(user?.position);
  const watchedScores = Form.useWatch('scores', form) || scores;
  const watchedAnswers = Form.useWatch('answers', form) || {};
  const total = formDef
    ? calcFormTotal(formDef, watchedAnswers)
    : calcTotal(watchedScores);
  const fullScore = formDef ? formDef.fullScore : 100;

  const onSubmit = async () => {
    // 该月自评已通过审核 → 已锁定，不允许再提交/覆盖
    if (locked) {
      message.warning('当月自评已经通过审核，无法提交新的自评');
      return;
    }
    try {
      // 提交时间不能晚于当前月份（月份下拉里未来月份已禁用，此处兜底校验）
      if (isFutureMonth(year, month)) {
        message.warning(
          `不能选择当前日期之后的月份提交（今天是 ${dayjs().format('YYYY年M月D日')}），请修改提交时间`
        );
        return;
      }
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        ...values,
        name: user.name,
        position: user.position,
        positionType: user.positionType,
        branch: user.branch, // 所属党支部（注册时确定）
        year,
        month, // 评价周期精确到月
      };
      if (formDef) {
        // 岗位专属表单：总分按所选选项计算，只存每题的选择
        const t = calcFormTotal(formDef, values.answers || {});
        payload.scores = { answers: values.answers || {} };
        payload.selfTotal = t;
      }
      await submitSelfEvaluation(payload);
      message.success(
        existing
          ? `已覆盖更新 ${year} 年 ${month} 月的自评，审核人以本次提交为准`
          : `${year} 年 ${month} 月自评提交成功，等待审核`
      );
      reload(year, month);
    } catch (e) {
      if (e?.errorFields) {
        message.warning('请检查表单填写是否完整');
      } else {
        console.error(e);
        // 后端返回的“已审核不能覆盖”等原因直接展示给用户
        message.error(e?.message || '提交失败，请稍后再试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const locked = existing?.reviewStatus === 'reviewed';
  const reviewed = existing?.reviewStatus === 'reviewed';
  const pending = !!existing && !reviewed;
  const empty = loaded && !existing;

  return (
    <div>
      {/* 模式 banner：员工模式 */}
      <Alert
        banner={false}
        type="info"
        showIcon
        icon={<EditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>党员自评模式</span>
            <Tag color="blue">{user?.name}</Tag>
            <Tag color="purple">
              {findPositionLabel(user?.position)} · {findLabel(POSITION_TYPES, user?.positionType)}
            </Tag>
          </Space>
        }
        description="您只能查看自己的评价记录与提交自我评价，无法访问其他党员的信息。"
        style={{ marginBottom: 16 }}
      />

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
        {reviewed && <Tag color="green" icon={<CheckCircleOutlined />}>已审核</Tag>}
        {pending && <Tag color="orange" icon={<ExclamationCircleOutlined />}>待审核</Tag>}
      </Space>

      {/* 完全空状态：引导员工首次提交 */}
      {empty && (
        <Card style={{ textAlign: 'center', padding: '24px 0' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  您在 {year} 年 {month} 月还没有自评记录
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  请在下方填写本年度党员自评，并点击「提交自评」
                </div>
              </div>
            }
          />
        </Card>
      )}

      {/* 锁定提示 */}
      {locked && (
        <Alert
          showIcon
          type="success"
          icon={<TrophyOutlined />}
          style={{ marginBottom: 16 }}
          message={`本次自评已由 ${existing.reviewerName || '审核人'} 完成，最终审核分为 ${existing.reviewScore} 分`}
          description="自评内容已锁定，不可再修改。如需复核请联系所属支部管理员。"
        />
      )}

      <Form form={form} layout="vertical" disabled={locked}>
        <Row gutter={16}>
          <Col span={16}>
            {/* 基本信息已移至「个人信息」页（点击顶栏右上角姓名进入） */}
            {formDef ? (
              // 岗位专属表单：选择题模式，选项后直接标注分值
              formDef.sections.map((sec) => (
                <Card
                  key={sec.title}
                  title={sec.title}
                  style={{ marginTop: 16 }}
                  extra={
                    sec.hint ? (
                      <span className="muted" style={{ fontSize: 12 }}>{sec.hint}</span>
                    ) : undefined
                  }
                >
                  {sec.items.map((it, idx) => (
                    <div
                      key={it.key}
                      style={{ marginBottom: idx === sec.items.length - 1 ? 0 : 20 }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {idx + 1}. {it.label}
                      </div>
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
                                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                                  {o.score > 0 ? `+${o.score} 分` : '不加分'}
                                </span>
                              </Radio>
                            ))}
                          </Space>
                        </Radio.Group>
                      </Form.Item>
                    </div>
                  ))}
                </Card>
              ))
            ) : (
              <Card title="分项自评（总分 100）" style={{ marginTop: 16 }}>
                {SCORE_DIMENSIONS.map((d) => (
                  <Row key={d.key} gutter={16} align="middle" style={{ marginBottom: 12 }}>
                    <Col span={6}>
                      <div style={{ fontWeight: 600 }}>{d.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{d.desc}</div>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name={['scores', d.key]}
                        rules={[
                          { required: true, message: '请打分' },
                          { type: 'number', min: 0, max: d.max, message: `0 - ${d.max} 分` },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          max={d.max}
                          step={1}
                          style={{ width: '100%' }}
                          addonAfter={`/ ${d.max}`}
                          onChange={(v) => setScores((s) => ({ ...s, [d.key]: v ?? 0 }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <InputNumber
                        min={0}
                        max={d.max}
                        step={1}
                        value={Math.round(((watchedScores?.[d.key] || 0) / d.max) * 100)}
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
            {/* 提交月历：当年各月提交状态一览，点格子可直接切换月份 */}
            <Card
              title={
                <Space>
                  <CalendarOutlined style={{ color: '#1677ff' }} />
                  <span>{year} 年提交月历</span>
                </Space>
              }
            >
              <div className="mini-cal">
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const st = monthRecords[m];
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
                    ? `${m} 月：未来月份，不可提交`
                    : st === 'reviewed'
                    ? `${m} 月：已审核`
                    : st === 'pending'
                    ? `${m} 月：已提交，待审核`
                    : `${m} 月：未提交，点击填写`;
                  return (
                    <Tooltip key={m} title={tip}>
                      <div
                        className={cls}
                        onClick={() => !future && setMonth(m)}
                      >
                        {m}月
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="mini-cal-legend">
                <span><i className="dot dot-pending" />待审核</span>
                <span><i className="dot dot-done" />已审核</span>
                <span><i className="dot dot-free" />未提交</span>
                <span><i className="dot dot-future" />不可选</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                只能提交当前月份及之前的自评，点击月份可切换查看
              </div>
            </Card>

            <Card
              className="score-card"
              style={{ marginTop: 16 }}
              title={
                <Space>
                  <StarFilled style={{ color: '#faad14' }} />
                  <span>我的自评总分</span>
                </Space>
              }
            >
              <Statistic
                value={total}
                suffix={` / ${fullScore}`}
                valueStyle={{ color: '#b71c1c', fontSize: 36 }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <div className="muted" style={{ fontSize: 12 }}>
                * 提交后由管理员完成最终审核评分
              </div>
            </Card>

            <Card title="提交" style={{ marginTop: 16 }}>
              <Button
                type="primary"
                block
                size="large"
                loading={submitting}
                onClick={onSubmit}
                icon={<EditOutlined />}
              >
                {existing ? '更新自评' : '提交自评'}
              </Button>
            </Card>

            {/* 已审核时：突出展示最终结果 */}
            {reviewed && (
              <Card
                title={
                  <Space>
                    <TrophyOutlined style={{ color: '#faad14' }} />
                    <span>最终审核结果</span>
                  </Space>
                }
                style={{ marginTop: 16, borderColor: '#faad14' }}
                headStyle={{ background: '#fffbe6' }}
              >
                <Statistic
                  title="最终审核分"
                  value={existing.reviewScore}
                  suffix={` / ${fullScore}`}
                  valueStyle={{ color: '#3f8600', fontSize: 32 }}
                />
                <div style={{ marginTop: 12 }}>
                  <Tag color="green" style={{ fontSize: 16, padding: '4px 12px' }}>
                    {formDef
                      ? calcFormGrade(existing.reviewScore || 0, fullScore)
                      : calcGrade(existing.reviewScore || 0)}
                  </Tag>
                </div>
                <Divider style={{ margin: '12px 0' }} />
                <div style={{ fontWeight: 600 }}>审核人评语：</div>
                <div style={{ marginTop: 4, color: 'rgba(0,0,0,0.85)' }}>
                  {existing.reviewComment || '（无）'}
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  审核人：{existing.reviewerName} · {existing.reviewedAt}
                </div>
              </Card>
            )}

            {/* 待审核时：展示当前自评分 + 提示 */}
            {pending && (
              <Card title="我的当前分数" style={{ marginTop: 16 }}>
                <Statistic
                  title="自评总分"
                  value={existing.selfTotal}
                  suffix={` / ${fullScore}`}
                />
                <div style={{ marginTop: 8 }}>
                  <Tag color="orange">等待管理员审核</Tag>
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  提交时间：{existing.createdAt}
                </div>
              </Card>
            )}
          </Col>
        </Row>
      </Form>
    </div>
  );
}