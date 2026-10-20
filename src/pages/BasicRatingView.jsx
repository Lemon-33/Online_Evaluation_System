// 基础积分评价详情（员工只读浏览自己某个月的扣分问卷）
// ------------------------------------------------------------
// 数据源：rating 表（由组织委员 / 党总支书记填写）
// 问卷内容：DEDUCTION_SECTIONS 扣分问卷（同组织委员那边的题目）
// 仅做"自己 / 自己当月" 的只读展示：题目 + 审核人选项 + 最终得分，
// 不允许修改。未来的月份不可选。
// 唯一入口（2026-10-16 改版）：
//   /basic-rating-view/:year/:month —— 从「个人积分查询 → 某月 → 查看评价」进来，
//   月份由上游确定 → 页面不再提供年份 / 月历选月，只保留「卷子 + 分数」，
//   顶部给一个「返回个人积分查询」按钮。
// 侧边栏不再常驻该入口（常驻一个空表单没意义），详见 src/lib/menu.js。
// 不带参数的旧兼容路由已删除（测试期没有老用户 / 老书签），参数缺失时兜底当前月。
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
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  StarFilled,
  TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DEDUCTION_BASE_SCORE,
  DEDUCTION_SECTIONS,
  deductionFormDefFromSnapshot,
  calcFinalScore,
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
import { getMyRating } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function BasicRatingView() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { year: pYear, month: pMonth } = useParams();
  // 月份由上游（个人积分查询 → 查看评价）通过路由参数确定，页面不再提供选月能力。
  // 参数缺失（手改 URL 等异常）时兜底为当前月，不额外做兼容入口。
  const year = Number(pYear) || dayjs().year();
  const month = Number(pMonth) || dayjs().month() + 1;
  const [loading, setLoading] = useState(false);
  // 当月记录：{ id, scores, reviewStatus, reviewScore, reviewerName, reviewComment, ... } | null
  const [record, setRecord] = useState(null);

  // 未来月份：不显示「暂无记录」类提示，改为未来月份提示
  const isFutureMonth = (y, m) => {
    const now = dayjs();
    return y > now.year() || (y === now.year() && m > now.month() + 1);
  };

  // 加载数据：只取该月一条（不再拉全年月历）
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const one = await getMyRating({ year, month });
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
  }, [year, month, user]);

  // 解析扣分问卷答案（不修改，只是展示）
  const answers = useMemo(
    () => (record?.scores && typeof record.scores === 'object' ? record.scores.answers : null) || {},
    [record]
  );

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
  const itemsFlat = useMemo(
    () =>
      (Array.isArray(sections) ? sections : []).flatMap((sec) =>
        (sec.items || []).map((it) => ({ ...it, sectionTitle: sec.title }))
      ),
    [sections]
  );

  // 优先用服务端落地的统计字段；老数据或无 record 时按 answers 重算
  const totalDeduction =
    (record?.scores && typeof record.scores === 'object' && record.scores.totalDeduction) ??
    calcTotalDeduction(answers, itemsFlat);
  const finalScore =
    record?.reviewScore != null
      ? Number(record.reviewScore)
      : record?.scores?.finalScore != null
      ? Number(record.scores.finalScore)
      : calcFinalScore(answers, itemsFlat);

  const isReviewed = record?.reviewStatus === 'reviewed';
  const hasDeduction = totalDeduction > 0;

  return (
    <div>
      {/* 顶部返回入口：月份已由「个人积分查询」确定，本页不选年月 */}
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/score-query')}>
          返回个人积分查询
        </Button>
        {isReviewed && <Tag color="green" icon={<CheckCircleOutlined />}>已评分</Tag>}
        {record && !isReviewed && <Tag color="orange" icon={<ExclamationCircleOutlined />}>待评分</Tag>}
        {!record && !isFutureMonth(year, month) && <Tag>无记录</Tag>}
        {isFutureMonth(year, month) && <Tag>未来月份</Tag>}
      </Space>

      {/* 顶部 banner：浏览模式（不是「自评模式」），标题直接带上年月 */}
      <Alert
        type="info"
        showIcon
        icon={<EyeOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>
              基础积分评价详情 · {year} 年 {month} 月
            </span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

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
          {/* 窄屏（<768px）左栏整行，右栏（分数卡）掉到下面 */}
          <Col span={16} xs={24} md={16}>
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
              <ReadOnlyDeduct answers={answers} sections={sections} />
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

          {/* 右：最终评分（月份由路由给定，不再需要月历） */}
          <Col span={8} xs={24} md={8}>
            {/* 最终评分：与「履职积分自评」页的得分框一致，不 sticky，
                随右栏内容正常排列（滚动时跟随页面一起走） */}
            <Card
              className="score-card"
              style={{ marginTop: 16, borderColor: '#faad14' }}
              title={
                <Space>
                  <StarFilled style={{ color: '#faad14' }} />
                  <span>最终评分</span>
                </Space>
              }
            >
              <Statistic
                title={`基础分`}
                value={DEDUCTION_BASE_SCORE}
                valueStyle={{ color: '#1677ff', fontSize: 24 }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Statistic
                title="累计扣分"
                value={totalDeduction}
                valueStyle={{
                  color: hasDeduction ? '#cf1322' : '#3f8600',
                  fontSize: 24,
                }}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Statistic
                title="最终得分"
                value={finalScore}
                valueStyle={{
                  color: '#3f8600', fontSize: 36,
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
function ReadOnlyDeduct({ answers, sections = DEDUCTION_SECTIONS }) {
  // 兼容两种落库形状：新 { count, reason } / 老数据直接数字
  const perItemDeduction = (it) =>
    Math.max(0, fillCountOf(answers?.[it.key]) * Math.abs(it.unitScore || 0));
  return (
    <>
      {sections.map((sec) => (
        <Card
          key={sec.title}
          title={sec.title}
          style={{ marginBottom: 16 }}
        >
          {sec.items.map((it, idx) => {
            const raw = answers?.[it.key];
            const v = fillCountOf(raw);
            const reason = fillReasonOf(raw);
            const deduction = perItemDeduction(it);
            const active = v > 0;
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
                {/* 该题具体事由（组织委员填写；不存在时整块不显示） */}
                {reason && (
                  <div style={{ fontSize: 13, marginTop: 8, marginLeft: 4 }}>
                    <span className="muted">具体事由：</span>
                    <span style={{ color: 'rgba(0,0,0,0.85)' }}>{reason}</span>
                  </div>
                )}
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
