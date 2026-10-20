import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  Spin,
  Alert,
} from 'antd';
import {
  LineChartOutlined,
  CalendarOutlined,
  EditOutlined,
  RiseOutlined,
  FallOutlined,
  TrophyOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getMemberMonthlyScores,
  getMemberAnnualScores,
  getMyEvaluation,
  getMyRating,
  getMyDiscipline,
  getMyCredit,
  getMyAnnualRank,
} from '../lib/cloudbase';
import { isMonthOpen, isFutureMonth, EVAL_OPEN_FROM_LABEL } from '../lib/constants';

// 月度下拉：1-12 + "全年"
const MONTH_OPTIONS = [
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` })),
  { value: 'all', label: '全年' },
];

// 年度下拉：2026 起 5 年回看（最新在前）；员工 / 管理员都能查历史
const currentYear = dayjs().year();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => ({
  value: y,
  label: `${y} 年`,
}));

const { Title, Text } = Typography;

export default function ScoreQuery() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(dayjs().month() + 1); // 默认当月
  const [loading, setLoading] = useState(false);
  const [monthly, setMonthly] = useState(null);   // { basic, contribution, total } | null
  const [annual, setAnnual] = useState(null);     // { basicAvg, contributionAvg, credit, discipline, total } | null
  const [error, setError] = useState('');
  // 本人当月自评记录（仅月度视图需要）：
  //   null = 还没提交过；有记录但 reviewStatus !== 'reviewed' = 待审核；'reviewed' = 已审核
  // 决定「当月履职贡献积分」下方那个链接的文案：提交自评 / 修改自评 / 查看评价
  const [selfEval, setSelfEval] = useState(null);
  // 本人当月基础积分记录（月度视图用）：决定「查看评价」是否可点 ——
  //   只有组织委员已评分（reviewStatus === 'reviewed'）才有卷子可看
  const [rating, setRating] = useState(null);
  // 本人该年度红线扣分记录（全年视图用）：同理，只有已核定才可看
  const [discipline, setDiscipline] = useState(null);
  // 本人该年度专项加分申报记录（全年视图用）：决定「年度专项加分」下方链接的文案 ——
  //   无记录 → 提交申请；有记录未审核 → 更新申请；已审核 → 查看评价
  const [credit, setCredit] = useState(null);
  // 本人年度总排名（全年视图用，全单位一起排）：{ ranked, rank, participants, ... } | null
  const [annualRank, setAnnualRank] = useState(null);

  // 切到「全年」时把月选择也保留在全年上以保持 UI 一致
  const isAll = month === 'all';

  // 自动查询：year / month 变化时重新拉
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        if (isAll) {
          const a = await getMemberAnnualScores({
            year,
            workId: user.workId,
            name: user.name,
          });
          if (!cancelled) {
            setAnnual(a);
            setMonthly(null);
          }
        } else {
          const m = await getMemberMonthlyScores({
            year,
            month: Number(month),
            workId: user.workId,
            name: user.name,
          });
          if (!cancelled) {
            setMonthly(m);
            setAnnual(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || '查询失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [year, month, user, isAll]);

  // 拉本人当月自评状态（全年视图不涉及单月自评，跳过）
  useEffect(() => {
    if (!user || isAll) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMyEvaluation(user.name, year, Number(month), user.workId);
        if (!cancelled) setSelfEval(rec || null);
      } catch {
        if (!cancelled) setSelfEval(null); // 查不到就按「未提交」处理，不影响主功能
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, year, month, isAll]);

  // 拉本人当月基础积分记录（全年视图无单月卷子，跳过）
  useEffect(() => {
    if (!user || isAll) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMyRating({ year, month: Number(month) });
        if (!cancelled) setRating(rec || null);
      } catch {
        if (!cancelled) setRating(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, year, month, isAll]);

  // 拉本人该年度红线扣分记录（仅全年视图需要）
  useEffect(() => {
    if (!user || !isAll) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMyDiscipline({ year });
        if (!cancelled) setDiscipline(rec || null);
      } catch {
        if (!cancelled) setDiscipline(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, year, isAll]);

  // 拉本人该年度专项加分申报记录（仅全年视图需要；没申报过 = null）
  useEffect(() => {
    if (!user || !isAll) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getMyCredit({ year });
        if (!cancelled) setCredit(rec || null);
      } catch {
        if (!cancelled) setCredit(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, year, isAll]);

  // 拉本人年度总排名（仅全年视图需要）：全单位一起排，实时算
  useEffect(() => {
    if (!user || !isAll) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await getMyAnnualRank({ year });
        if (!cancelled) setAnnualRank(r || null);
      } catch {
        if (!cancelled) setAnnualRank(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, year, isAll]);

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <LineChartOutlined style={{ marginRight: 8, color: '#1677ff' }} />
        个人积分查询
      </Title>


      <Card style={{ marginTop: 16 }}>
        <Space size={16} wrap>
          <Space>
            <CalendarOutlined />
            <Text strong>年度</Text>
            <Select
              value={year}
              options={YEAR_OPTIONS}
              onChange={setYear}
              style={{ width: 120 }}
            />
          </Space>
          <Space>
            <Text strong>月度</Text>
            <Select
              value={month}
              options={MONTH_OPTIONS}
              onChange={setMonth}
              style={{ width: 120 }}
            />
          </Space>
        </Space>
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="查询失败"
          description={error}
        />
      )}

      <Spin spinning={loading} style={{ marginTop: 16 }}>
        {isAll ? (
          <AnnualView
            data={annual}
            year={year}
            redlineReviewed={discipline?.reviewStatus === 'reviewed'}
            credit={credit}
            rank={annualRank}
          />
        ) : (
          <MonthlyView
            data={monthly}
            year={year}
            month={month}
            selfEval={selfEval}
            basicReviewed={rating?.reviewStatus === 'reviewed'}
          />
        )}
      </Spin>
    </div>
  );
}

// 月度视图：4 张卡（基础 / 履职贡献 / 总分 / 全支部排名）
// 「当月基础积分」卡下方有「查看评价」超链接 → 跳该月的基础积分评价详情
//   （年度视图不加：年度是汇总口径，没有单月卷子可看）
function MonthlyView({ data, year, month, selfEval, basicReviewed }) {
  const nav = useNavigate();
  if (!data) return null;
  // rank 为 null = 本月本人还没有已审核记录，不参与排名
  const ranked = Number.isFinite(data.rank) && data.rank > 0;
  // 是否进入前 50%（名次 ≤ 参与人数的一半，向上取整）—— 只有前 50% 的名次才加粗
  const inTopHalf =
    ranked && data.participants > 0 && data.rank <= Math.ceil(data.participants / 2);
  // 自评链接文案（随当月状态变化）：未提交 / 已提交待审核 / 已审核
  //   统一跳「每月履职贡献自评」页并带上当前查看的年月，那边按状态给可编辑 / 只读表单
  const reviewed = selfEval?.reviewStatus === 'reviewed';
  const selfLabel = !selfEval ? '提交自评' : reviewed ? '查看评价' : '修改自评';
  // 该月自评入口是否可用：可提交范围 = [2026-10（下界）, 当前月（上界）]
  //   早于下界 → 已封档；晚于上界 → 尚未开启。两种都置灰，但悬停提示不同
  const monthOpen = isMonthOpen(year, month);
  const futureMonth = isFutureMonth(year, month);
  const selfDisabled = !monthOpen || futureMonth;
  const selfTip = !monthOpen
    ? `${year} 年 ${month} 月已封档（可提交范围：${EVAL_OPEN_FROM_LABEL} 起）`
    : futureMonth
    ? `${year} 年 ${month} 月尚未开启，未到提交时间`
    : '';
  const goSelfEval = () => nav('/self', { state: { year, month } });
  return (
    <Row gutter={16} style={{ marginTop: 8 }}>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="当月基础积分"
            value={data.basic}
            precision={2}
            suffix="分"
            valueStyle={{ color: '#000' }}
          />
          {/* 查看该月组织委员填写的扣分问卷（只读）
              当月基础积分还没评价（无记录 / 待评分）→ 置灰不可点，悬停说明原因 */}
          <Tooltip
            title={basicReviewed ? '' : `${year} 年 ${month} 月基础积分尚未评价，暂无卷子可看`}
          >
            <Button
              type="link"
              icon={<FileSearchOutlined />}
              disabled={!basicReviewed}
              style={{ paddingLeft: 0, marginTop: 4 }}
              onClick={() => nav(`/basic-rating-view/${year}/${month}`)}
            >
              查看评价
            </Button>
          </Tooltip>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic
            title="当月履职贡献积分"
            value={data.contribution}
            precision={2}
            suffix="分"
            valueStyle={{ color: '#000' }}
          />
          {/* 去「每月履职贡献自评」：文案随当月状态变化（提交 / 修改 / 查看）
              已封档的月份（2026 年 9 月及以前）/ 未开启的未来月份 → 置灰不可点，
              悬停说明原因（封档 vs 尚未开启，两种提示不同） */}
          <Tooltip title={selfTip}>
            <Button
              type="link"
              icon={reviewed ? <FileSearchOutlined /> : <EditOutlined />}
              disabled={selfDisabled}
              style={{ paddingLeft: 0, marginTop: 4 }}
              onClick={goSelfEval}
            >
              {selfLabel}
            </Button>
          </Tooltip>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        {/* 总分卡：蓝色点缀（渐变底 + 浅阴影 + 图标），与右侧排名卡呼应 */}
        <Card
          style={{
            borderColor: '#1677ff',
            background: 'linear-gradient(135deg, #f0f7ff 0%, #ffffff 72%)',
            boxShadow: '0 2px 8px rgba(22,119,255,0.12)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title={
                <Space size={4}>
                  <LineChartOutlined style={{ color: '#1677ff' }} />
                  <span>当月总分</span>
                </Space>
              }
              value={data.total}
              precision={2}
              suffix="分"
              valueStyle={{ color: '#1677ff', fontWeight: 700 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              基础积分 + 履职贡献
            </Text>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        {/* 与年度排名同一套显示方式：大字只有「第 X 名」，
            参与人数以小字提示在下方；未参与时显示 --
            **只有前 50% 才加粗**，其余名次不加粗 */}
        <Card style={ranked ? { borderColor: '#faad14' } : undefined}>
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title={
                <Space size={4}>
                  <TrophyOutlined style={{ color: '#faad14' }} />
                  <span>支部月度排名</span>
                </Space>
              }
              value={ranked ? data.rank : '--'}
              prefix={ranked ? '第' : ''}
              suffix={ranked ? '名' : ''}
              valueStyle={{ color: '#000', fontWeight: inTopHalf ? 700 : 400 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {ranked
                ? `支部共 ${data.participants} 人参与本月排名`
                : '本月暂不参与排名'}
            </Text>
          </div>
        </Card>
      </Col>
    </Row>
  );
}

// 全年视图：5 张卡（月度基础平均 / 月度履职贡献平均 / 创新加分 / 红线扣分 / 总分）
// 「年度红线总扣分」卡下方有「查看评价」超链接 → 跳该年度的红线扣分卷子
//   （月度视图不加：月度是基础 + 履职贡献，没有年度红线卷子可看）
function AnnualView({ data, year, redlineReviewed, credit, rank }) {
  const nav = useNavigate();
  if (!data) return null;
  // 年度专项加分：按 credit 表当年记录的状态给不同文案（都进同一页，页面内按状态可改 / 只读）
  //   无记录 → 提交申请；有记录未审核 → 更新申请；已审核 → 查看评价
  const creditReviewed = credit?.reviewStatus === 'reviewed';
  const creditLabel = !credit ? '提交申请' : creditReviewed ? '查看评价' : '更新申请';
  // 同月度：只有进入前 50% 的名次才加粗（ranked = 已参与排名且有名次）
  const annualInTopHalf =
    rank?.ranked &&
    rank.participants > 0 &&
    rank.rank <= Math.ceil(rank.participants / 2);
  const goCredit = () => nav('/credit-apply', { state: { year } });
  const {
    basicAvg = 0,
    contributionAvg = 0,
    credit: creditScore = 0, // 注意：prop 里的 credit 是本人申报记录，这里是年度接口给的分数
    discipline = 0,
    total = 0,
  } = data;
  return (
    <>
      <Row gutter={16} style={{ marginTop: 8 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="月度基础积分平均分"
              value={basicAvg}
              precision={2}
              suffix="分"
              valueStyle={{ color: '#000' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="月度履职贡献积分平均分"
              value={contributionAvg}
              precision={2}
              suffix="分"
              valueStyle={{ color: '#000' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="年度专项加分"
              value={creditScore}
              precision={2}
              suffix="分"
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#000' }}
            />
            {/* 去「年度专项加分申请提交」页：文案按当年申报状态变化（提交 / 更新 / 查看） */}
            <Button
              type="link"
              icon={creditReviewed ? <FileSearchOutlined /> : <EditOutlined />}
              style={{ paddingLeft: 0, marginTop: 4 }}
              onClick={goCredit}
            >
              {creditLabel}
            </Button>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="年度红线扣分"
              value={discipline}
              precision={2}
              suffix="分"
              prefix={<FallOutlined />}
              valueStyle={{ color: '#000' }}
            />
            {/* 查看该年度支部书记 / 党总支书记核定的红线扣分卷子（只读）
                该年度红线还没核定（无记录 / 待核定）→ 置灰不可点，悬停说明原因 */}
            <Tooltip
              title={redlineReviewed ? '' : `${year} 年红线扣分尚未核定，暂无卷子可看`}
            >
              <Button
                type="link"
                icon={<FileSearchOutlined />}
                disabled={!redlineReviewed}
                style={{ paddingLeft: 0, marginTop: 4 }}
                onClick={() => nav(`/redline-view/${year}`)}
              >
                查看评价
              </Button>
            </Tooltip>
          </Card>
        </Col>
      </Row>
      {/* 年度总分 + 年度总排名：同一行，各占一半宽度；框内元素居中。
          排名 = 全单位一起排（实时算），只显示本人名次与参与人数，不展示他人分数。 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12}>
          {/* 与月度「当月总分」同款蓝色点缀（渐变底 + 浅阴影 + 图标） */}
          <Card
            style={{
              borderColor: '#1677ff',
              background: 'linear-gradient(135deg, #f0f7ff 0%, #ffffff 72%)',
              boxShadow: '0 2px 8px rgba(22,119,255,0.12)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <Statistic
                title={
                  <Space size={4}>
                    <LineChartOutlined style={{ color: '#1677ff' }} />
                    <span>年度总分</span>
                  </Space>
                }
                value={total}
                precision={2}
                suffix="分"
                valueStyle={{ color: '#1677ff', fontWeight: 700 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                基础 / 履职贡献月均 + 专项加分 + 红线扣分
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card style={{ borderColor: '#faad14' }}>
            <div style={{ textAlign: 'center' }}>
              {/* 未参与排名（当年缺基础积分 / 履职贡献记录）→ 显示 -- */}
              <Statistic
                title={
                  <Space size={4}>
                    <TrophyOutlined style={{ color: '#faad14' }} />
                    <span>年度总排名（全单位）</span>
                  </Space>
                }
                value={rank?.ranked ? rank.rank : '--'}
                prefix={rank?.ranked ? '第' : ''}
                suffix={rank?.ranked ? '名' : ''}
                // 同月度：只有前 50% 才加粗
                valueStyle={{ color: '#000', fontWeight: annualInTopHalf ? 700 : 400 }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {rank?.ranked
                  ? `共 ${rank.participants} 人参与 ${year} 年度排名`
                  : rank
                    ? `${year} 年度暂无你的基础积分 / 履职贡献记录，暂不参与排名`
                    : '排名计算中'}
              </Text>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
