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
  MinusCircleOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SCORE_DIMENSIONS,
  calcTotal,
  calcGrade,
  calcFormTotal,
  getPositionForm,
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { getMyEvaluation, submitSelfEvaluation, listEvaluations } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function SelfEvaluation() {
  const { user } = useAuth();
  // 自评页仅 admin_type∈{1,3}（普通党员 / 组织委员）使用，始终按「被评人」处理：
  // 「履职扣分」段只在已审核时回显，不做可编辑展示（故恒为 false）
  const isAdmin = false;
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

    // 填空题：无论何时进入页面都强制默认 { count: 0, reason: '' }（选择题保留 rec 中的旧值用于回显修改）
      const fillDefaults = (answers, fd) => {
        if (!fd) return answers;
        const out = { ...answers };
        fd.sections.forEach((sec) =>
          sec.items.forEach((it) => {
            if (it.type === 'fill') {
              out[it.key] = { count: 0, reason: '' };
            }
          })
        );
        return out;
      };

  const reload = async (y, m) => {
    if (!user?.name) return;
    // 切换账号/月份前先把表单清空，避免上一个账号的 setFieldsValue 残留
    form.resetFields();
    // 并行取两份数据：当前月的记录 + 当年全部记录（供月历展示）
    // workId 优先传入，用于区分同名员工（展示层不变，仅数据匹配用）
    const [rec, all] = await Promise.all([
      getMyEvaluation(user.name, y, m, user.workId),
      listEvaluations({ year: y, keyword: user.name }),
    ]);
    setExisting(rec);
    // keyword 是模糊搜索（"张三"可能搜到"张三丰"），需精确过滤本人：
    // 有工号按工号匹配（同名不同人也能锁定本人），无工号回落按姓名
    const byMonth = {};
    all
      .filter((x) =>
        user.workId ? x.work_id === user.workId : x.name === user.name
      )
      .forEach((x) => {
        byMonth[x.month || 1] = x.reviewStatus;
      });
    setMonthRecords(byMonth);
    if (rec) {
      // 兼容两种历史数据：岗位表单（scores.answers）与通用 5 项（直接分值）
      // 已审核回显规则（仅展示层，后端不动）：
      //   - 基础履职 / 提质赋分（"前两部分"）的填空题：
      //       count  = 审核人定稿（reviewScores）
      //       reason = 员工原始自评（scores，员工自述保留）
      //   - 履职扣分：员工自评没填过，整段从 reviewScores 取（含 count+reason）
      //   - 选择题 / 通用 5 项打分：保持员工原始自评
      const userAnswers = rec.scores?.answers || {};
      const reviewAnswers = rec.reviewScores?.answers || {};
      const answers = fillDefaults(userAnswers, formDef);
      formDef?.sections.forEach((sec) => {
        const isDeduct = sec.title === '履职扣分';
        sec.items.forEach((it) => {
          const r = reviewAnswers[it.key];
          if (r === undefined || r === null) return; // 审核人没动过 → 保持员工原始
          if (isDeduct) {
            // 扣分由审核人整段录入：原样覆盖
            answers[it.key] = r;
          } else if (it.type === 'fill') {
            // 前两部分填空题：count 取审核人定稿，reason 保留员工自评
            const u = userAnswers[it.key] || {};
            const userReason = typeof u === 'object' ? (u.reason ?? '') : '';
            const reviewCnt = Number(r?.count ?? r) || 0;
            answers[it.key] = { count: reviewCnt, reason: userReason };
          } else {
            // 选择题：保持员工原始自评（审核人通常不动选择题）
            // （如果以后需要让审核人改选择题，把这行去掉即可）
          }
        });
      });
      form.setFieldsValue({
        partyBranch: user?.branch || rec.partyBranch || '',
        scores: rec.scores?.answers ? {} : rec.scores || {},
        answers,
      });
      setScores(rec.scores?.answers ? {} : rec.scores || {});
    } else {
      form.setFieldsValue({
        partyBranch: user?.branch || '',
        scores: {},
        answers: fillDefaults({}, formDef),
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
  // 员工侧「自评总分」不含履职扣分（扣分由审核人填写，结果看「最终审核结果」卡片）；
  // 已审核回显扣分答案后这里显式排除，避免总分被扣分拉低。管理员侧沿用整表单。
  const totalFormDef =
    formDef && !isAdmin
      ? { sections: formDef.sections.filter((s) => s.title !== '履职扣分') }
      : formDef;
  const total = totalFormDef
    ? calcFormTotal(totalFormDef, watchedAnswers)
    : calcTotal(watchedScores);

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

      // ---- 主动校验（不依赖 antd 的隐式 required，绕开 Radio.Group 偶发漏检） ----
      // 兼容性更好：先用 form.getFieldValue 拿到当前 answers，自己遍历 formDef 校验每一题
      const answers = form.getFieldValue('answers') || {};
      const missing = [];
      if (formDef) {
        for (const sec of formDef.sections) {
          if (!isAdmin && sec.title === '履职扣分') continue; // 员工无扣分题
          for (const it of sec.items) {
            const v = answers[it.key];
            // 填空题新形状 {count, reason}：只校验 count 必填且为数字
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
        const scores = form.getFieldValue('scores') || {};
        for (const dim of SCORE_DIMENSIONS) {
          if (scores[dim.key] === undefined || scores[dim.key] === null || scores[dim.key] === '') {
            missing.push(`「${dim.label}」`);
          }
        }
      }
      if (missing.length > 0) {
        message.warning(`还有 ${missing.length} 道题未填写：${missing.join('；')}`);
        return; // 不调用 validateFields 也不提交
      }

      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        ...values,
        name: user.name,
        work_id: user.workId || '', // 员工工号：服务端按此区分同名员工
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
      // 保留表单内容（不调 reload：reload 内部会 form.resetFields() 再 setFieldsValue()，
      //   那一瞬"清空再回填"在网速慢时看起来像被清了）。
      // 这里只刷新"已提交"状态字段：existing + 月历的当月格子；
      //   表单维持用户刚填的值 → 可直接改、可再次提交。
      try {
        const updated = await getMyEvaluation(user.name, year, month, user.workId);
        setExisting(updated);
        setMonthRecords((prev) => ({ ...prev, [month]: updated?.reviewStatus || 'pending' }));
      } catch {
        // 即便拉最新记录失败，提交本身已成功；至少把月历当月标 pending，不影响表单
        setMonthRecords((prev) => ({ ...prev, [month]: 'pending' }));
      }
    } catch (e) {
      if (e?.errorFields) {
        // antd 校验兜底（理论上主动校验后不会到这里，留作双保险）
        const labels = e.errorFields
          .map((f) => {
            const key = Array.isArray(f.name) ? f.name[f.name.length - 1] : f.name;
            if (formDef) {
              for (const sec of formDef.sections) {
                const it = sec.items.find((i) => i.key === key);
                if (it) return `「${sec.title}」${it.label}`;
              }
            }
            const dim = SCORE_DIMENSIONS.find((d) => d.key === key);
            if (dim) return `「${dim.label}」`;
            return key;
          })
          .filter(Boolean);
        message.warning(`还有 ${labels.length} 道题未填写：${labels.join('；')}`);
      } else {
        console.error(e);
        message.error(e?.message || '提交失败，请稍后再试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const locked = existing?.reviewStatus === 'reviewed';
  const reviewed = existing?.reviewStatus === 'reviewed';
  const pending = !!existing && !reviewed;

  // 已审核：统计 + 渲染审核人对前两段（基础履职 / 提质赋分）修改过的题目
  //   对比基准 = 员工原始自评（scores）vs 审核定稿（reviewScores），不同的题目标注出来
  const changedCount = useMemo(() => {
    if (!locked || isAdmin || !formDef) return 0;
    const admin = existing?.reviewScores?.answers || {};
    const mine = existing?.scores?.answers || {};
    let n = 0;
    formDef.sections
      .filter((s) => s.title !== '履职扣分')
      .forEach((sec) =>
        sec.items.forEach((it) => {
          const a = admin[it.key];
          if (a === undefined || a === null) return;
          const m = mine[it.key];
          const same =
            it.type === 'fill'
              ? Number(a || 0) === Number(m || 0)
              : a === m;
          if (!same) n += 1;
        })
      );
    return n;
  }, [existing, locked, isAdmin, formDef]);

  // 单题标注：本题被审核人改过 → 显示「审核人修改」+ 核定结果
  // 仅前两部分（基础履职 / 提质赋分）标注；履职扣分段员工本来没填过，
  // 谈不上「修改」，直接回显审核人选择的答案即可，不加任何提示
  const renderReviewChange = (sec, it) => {
    if (!locked || isAdmin || sec.title === '履职扣分') return null;
    const adminV = existing?.reviewScores?.answers?.[it.key];
    if (adminV === undefined || adminV === null) return null;
    const myV = existing?.scores?.answers?.[it.key];
    // 填空题兼容 {count, reason} 与老形状（直接数字）
    const adminCnt = Number(adminV?.count ?? adminV) || 0;
    const myCnt = Number(myV?.count ?? myV) || 0;
    const same =
      it.type === 'fill' ? adminCnt === myCnt : adminV === myV;
    if (same) return null;
    if (it.type === 'fill') {
      // 表单框内已是审核人核定的 count；标签额外显示"原提交 → 核定"对比，方便员工核对
      return (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          <Tag color="orange" icon={<AuditOutlined />}>
            审核人已核定
          </Tag>
          <span className="muted">
            您原提交 <b>{myCnt}{it.unit || ''}</b> → 核定 <b style={{ color: '#d46b08' }}>{adminCnt}{it.unit || ''}</b>
          </span>
        </div>
      );
    }
    const label = it.options?.find((o) => o.value === adminV)?.label || adminV;
    return (
      <div style={{ marginTop: 6, fontSize: 13 }}>
        <Tag color="orange" icon={<AuditOutlined />}>审核人修改</Tag>
        <span className="muted">核定结果：</span>
        <span style={{ fontWeight: 600 }}>{label}</span>
      </div>
    );
  };

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

      {/* 锁定提示 */}
      {locked && (
        <Alert
          showIcon
          type="success"
          icon={<TrophyOutlined />}
          style={{ marginBottom: 16 }}
          message={`本次自评已由 ${existing.reviewerName || '审核人'} 完成，最终审核分为 ${existing.reviewScore} 分`}
          description={
            changedCount > 0
              ? `自评内容已锁定，不可再修改。审核人修改了 ${changedCount} 处选项，对应题目已标注「审核人修改」；履职扣分见下方红色卡片。如需复核请联系所属支部管理员。`
              : '自评内容已锁定，不可再修改。如需复核请联系所属支部管理员。'
          }
        />
      )}

      <Form form={form} layout="vertical" disabled={locked} key={user?.name || 'guest'}>
        <Row gutter={16}>
          <Col span={16}>
            {/* 基本信息已移至「个人信息」页（点击顶栏右上角姓名进入） */}
            {formDef ? (
              // 岗位专属表单：选择题模式，选项后直接标注分值
              // 非管理员平时不显示「履职扣分」段（扣分由管理员在审核页录入）；
              // 已审核后展示该段（表单整体 disabled → 只读），回显审核人填写的答案
              formDef.sections
                .filter(
                  (sec) => isAdmin || sec.title !== '履职扣分' || locked
                )
                .map((sec) => {
                  const isDeduct = sec.title === '履职扣分';
                  return (
                <Card
                  key={sec.title}
                  title={
                    isDeduct && !isAdmin ? (
                      <Space>
                        <MinusCircleOutlined style={{ color: '#cf1322' }} />
                        <span>履职扣分（审核人填写）</span>
                      </Space>
                    ) : (
                      sec.title
                    )
                  }
                  style={{
                    marginTop: 16,
                    borderColor: isDeduct && !isAdmin ? '#ffa39e' : undefined,
                  }}
                >
                  {isDeduct && !isAdmin && (
                    <div className="muted" style={{ marginBottom: 16, fontSize: 12 }}>
                      以下为审核人完成审核时填写的履职扣分记录，仅供参考，不可修改。
                    </div>
                  )}
                  {sec.items.map((it, idx) => (
                    <div
                      key={it.key}
                      style={{ marginBottom: idx === sec.items.length - 1 ? 0 : 20 }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {idx + 1}. {it.label}
                        {it.type === 'fill' && (
                          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            （每{it.unit} {it.unitScore > 0 ? '+' : ''}{it.unitScore} 分）
                          </span>
                        )}
                      </div>
                      {it.type === 'fill' ? (
                        <>
                          <Form.Item
                            name={['answers', it.key, 'count']}
                            rules={[
                              { required: true, message: '请输入数量' },
                              { type: 'number', min: 0, max: 30, message: '请输入 0-30 的整数' },
                            ]}
                            style={{ marginBottom: it.hasReason !== false ? 8 : 0 }}
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
                                // 允许：编辑键 + 数字 0-9；其它字母/符号一律拦截在输入之前
                                if (e.ctrlKey || e.metaKey || e.altKey) return; // 保留复制粘贴等组合键
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
                                const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
                                if (!/^\d+$/.test(text)) e.preventDefault();
                              }}
                            />
                          </Form.Item>
                          {it.hasReason !== false && (
                            <Form.Item
                              name={['answers', it.key, 'reason']}
                              style={{ marginBottom: 0 }}
                            >
                              <Input.TextArea
                                rows={2}
                                maxLength={500}
                                showCount
                                placeholder="请说明为什么得分（选填）"
                              />
                            </Form.Item>
                          )}
                        </>
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
                                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                                    {o.score === 0 ? '不加分' : `${o.score > 0 ? '+' : ''}${o.score} 分`}
                                  </span>
                                </Radio>
                              ))}
                            </Space>
                          </Radio.Group>
                        </Form.Item>
                      )}
                      {/* 本题被审核人改过 → 标注核定结果（履职扣分段不标注） */}
                      {renderReviewChange(sec, it)}
                    </div>
                  ))}
                </Card>
                  );
                })
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
                  valueStyle={{ color: '#3f8600', fontSize: 32 }}
                />
                {!formDef && (
                  <div style={{ marginTop: 12 }}>
                    <Tag color="green" style={{ fontSize: 16, padding: '4px 12px' }}>
                      {calcGrade(existing.reviewScore || 0)}
                    </Tag>
                  </div>
                )}
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