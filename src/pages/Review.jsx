import { useEffect, useState, useMemo } from 'react';
import {
  Table,
  Tag,
  Button,
  Input,
  Space,
  Select,
  message,
  Empty,
  Statistic,
  Alert,
  Badge,
  Card,
  Row,
  Col,
  Modal,
} from 'antd';
import {
  AuditOutlined,
  BellOutlined,
  TrophyOutlined,
  WarningOutlined,
  EyeOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  findBranchLabel,
} from '../lib/constants';
import { listEvaluations, getUnsubmittedCount } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../lib/useIsMobile';

export default function Review() {
  const { user } = useAuth();
  // 窄屏：表格横向滚动（列宽是定值，不加会把整个页面撑出横向滚条）
  const isMobile = useIsMobile();
  const [year, setYear] = useState(new Date().getFullYear());
  // 进入页面默认选中「当前月份」（避免管理员打开看到空的全年列表）
  const [month, setMonth] = useState(new Date().getMonth() + 1); // '' = 全年，1-12 = 指定月份
  const [status, setStatus] = useState('pending');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate(); // 「审核」→ 整页审核表单 /review-form/:id

  // 所有审核人（含党总支书记）的范围一律由 review_assignment 决定：
  // 党总支书记不再「看全体」，刚注册时审核对象为空，需系统管理员在「审核关系维护」里指派
  const scopeBranch = user?.branch;

  // 范围内的待审 / 已审核 / 未提交自评人数（不受 status 切换影响）
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [unsubmittedCount, setUnsubmittedCount] = useState(0);
  const [unsubList, setUnsubList] = useState([]); // 未提交名单（弹窗展示用）
  const [unsubOpen, setUnsubOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      // 「未提交人数」只在选定了具体月份时才有意义；全年视图下不查、不显示
      const needUnsubmitted = !!month;
      const tasks = [
        listEvaluations({ year, month, status, keyword, branch: scopeBranch, scope: 'assignments' }),
        listEvaluations({ year, month, status: 'pending', branch: scopeBranch, scope: 'assignments' }),
        listEvaluations({ year, month, status: 'reviewed', branch: scopeBranch, scope: 'assignments' }),
      ];
      if (needUnsubmitted)
        tasks.push(getUnsubmittedCount({ year, month, branch: scopeBranch }));

      const [data, p, r, unsub] = await Promise.all(tasks);
      setList(data);
      setPendingCount(p.length);
      setReviewedCount(r.length);
      setUnsubmittedCount(needUnsubmitted ? unsub?.unsubmitted || 0 : 0);
      setUnsubList(needUnsubmitted ? unsub?.list || [] : []);
    } catch (e) {
      console.error(e);
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, status, keyword]);

  // 统计卡片标题里的范围描述：「2026 年 9 月」或「2026 年」
  const scopeLabel = month ? `${year} 年 ${month} 月` : `${year} 年`;

  // 点击「审核」→ 跳整页审核表单（按记录 id 定位；路由守卫 perm="review"）
  // 表单按被审核人的岗位渲染，前两段回显员工答案，履职扣分段由审核人填写
  const openReview = (rec) => navigate(`/review-form/${rec.id}`);

  // 复制未提交名单（http 环境下 clipboard API 可能不可用 → 传统方案兜底）
  const copyUnsubList = async () => {
    const text = unsubList.map((u) => u.name).join('\r\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制 ${unsubList.length} 个姓名`);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) message.success(`已复制 ${unsubList.length} 个姓名`);
      else message.warning('复制失败，请在弹窗里手动全选复制');
    }
  };

  // 项目规范：表格所有列（含表头）一律居中 —— align: 'center'
  const columns = [
    { title: '姓名', dataIndex: 'name', width: 100, align: 'center' },
    {
      title: '岗位 / 类型',
      width: 200,
      align: 'center',
      render: (_, r) =>
        `${findPositionLabel(r.position)} / ${findLabel(POSITION_TYPES, r.positionType)}`,
    },
    {
      title: '月份',
      dataIndex: 'month',
      width: 70,
      align: 'center',
      render: (v) => `${v || 1} 月`,
    },
    {
      title: '党支部',
      dataIndex: 'partyBranch',
      width: 140,
      align: 'center',
      render: (v) => findBranchLabel(v),
    },
    {
      title: '自评总分',
      dataIndex: 'selfTotal',
      width: 90,
      align: 'center',
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 160,
      align: 'center',
    },
    {
      // 状态一律看「我的审核状态」（后端按 reviewers 列派生）：
      //   一个被审核人可以有多个审核人，记录级 reviewStatus 只表示「这条卷子有没有被审过」，
      //   甲审完会把乙的也标成 reviewed；只有 myReviewStatus 能表达「**我**审过没有」。
      title: '状态',
      dataIndex: 'myReviewStatus',
      width: 100,
      align: 'center',
      render: (s, rec) => (
        <div>
          {(s || rec.reviewStatus) === 'reviewed' ? (
            <Tag color="green">已审核</Tag>
          ) : (
            <Tag color="orange">待审核</Tag>
          )}
          {/* 我审过、但之后被别的审核人覆盖了（当前生效的不是我的那版） */}
          {rec.overriddenByOther && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              已被他人更新
            </div>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      width: 120,
      align: 'center',
      render: (_, rec) => (
        <Button type="link" onClick={() => openReview(rec)}>
          {(rec.myReviewStatus || rec.reviewStatus) === 'reviewed' ? '重新审核' : '审核'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      {/* 抬头 banner：与「年度红线扣分审核」/「年度专项加分审核」同一套写法
          （标题 + 人名 + 操作说明），但不带「审核范围」小框 ——
          本页范围由「审核关系维护」逐人指派决定，不是一个支部能概括的 */}
      <Alert
        type="warning"
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>履职贡献评价审核</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片：标题跟随所选年月范围 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <BellOutlined />
                  <span>{scopeLabel}待审核</span>
                </Space>
              }
              value={pendingCount}
              suffix="人"
              valueStyle={{ fontSize: 20, color: pendingCount > 0 ? '#cf1322' : '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <TrophyOutlined />
                  <span>{scopeLabel}已审核</span>
                </Space>
              }
              value={reviewedCount}
              suffix="人"
              valueStyle={{ fontSize: 20, color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8} xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic
              title={
                <Space>
                  <WarningOutlined />
                  <span>未提交审核人数</span>
                </Space>
              }
              // 全年视图下不适用，直接显示「—」
              value={month ? unsubmittedCount : '—'}
              suffix={month ? '人' : ''}
              valueStyle={{
                fontSize: 20,
                color: month
                  ? unsubmittedCount > 0
                    ? '#fa541c'
                    : '#3f8600'
                  : '#bfbfbf',
              }}
            />
            {/* 有人未提交时提供「查看」入口（小弹窗展示名单，不离开列表页） */}
            {month && unsubmittedCount > 0 && (
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                style={{ padding: 0, marginTop: 4 }}
                onClick={() => setUnsubOpen(true)}
              >
                查看
              </Button>
            )}
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }} size="middle" wrap>
        <Badge count={pendingCount} offset={[4, -2]} color="#fa541c">
          <Tag color="orange" style={{ padding: '4px 12px', fontSize: 14 }}>
            {pendingCount} 条待审核
          </Tag>
        </Badge>
      </Space>

      <Space style={{ marginBottom: 16 }} size="middle" wrap>
        <span>年度：</span>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 100 }}
          options={[
            { value: 2027, label: 2027 },
            { value: 2026, label: 2026 },
          ]}
        />
        <span>月份：</span>
        <Select
          value={month}
          onChange={setMonth}
          style={{ width: 100 }}
          options={[
            { value: '', label: '全年' },
            ...Array.from({ length: 12 }, (_, i) => ({
              value: i + 1,
              label: `${i + 1} 月`,
            })),
          ]}
        />
        <span>状态：</span>
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 120 }}
          options={[
            { value: 'pending', label: '待审核' },
            { value: 'reviewed', label: '已审核' },
            { value: '', label: '全部' },
          ]}
        />
        <Input.Search
          placeholder="按姓名搜索"
          allowClear
          style={{ width: 220 }}
          // 只更新 keyword，由 useEffect 依赖触发重新加载
          onSearch={(v) => setKeyword(v)}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={isMobile ? { x: 'max-content' } : undefined}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
        pagination={{ pageSize: 10 }}
      />

      {/* 审核表单已独立成整页（/review-form/:id）：
          点「审核」按记录 id 跳转，按被审核人岗位渲染完整表单，
          前两段回显员工答案，履职扣分段由审核人填写，右侧实时算分 */}

      {/* 未提交名单弹窗：一行一个姓名，可鼠标全选复制，也可一键复制 */}
      <Modal
        open={unsubOpen}
        onCancel={() => setUnsubOpen(false)}
        title={`${scopeLabel}未提交名单（${unsubList.length} 人）`}
        width={420}
        footer={[
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={copyUnsubList}
          >
            复制全部
          </Button>,
        ]}
      >
        {unsubList.length > 0 ? (
          <div
            style={{
              maxHeight: 360,
              overflow: 'auto',
              // 关键：允许鼠标拖选文字（antd 默认样式不影响，这里显式声明）
              userSelect: 'text',
              WebkitUserSelect: 'text',
              whiteSpace: 'pre-line',
              lineHeight: '28px',
              fontSize: 14,
              background: '#fafafa',
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: '12px 16px',
              cursor: 'text',
            }}
          >
            {unsubList.map((u) => u.name).join('\n')}
          </div>
        ) : (
          <Empty description="本月全员已提交" />
        )}
      </Modal>
    </div>
  );
}