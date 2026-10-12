import { useEffect, useState, useMemo } from 'react';
import {
  Table,
  Tag,
  Button,
  Drawer,
  Descriptions,
  Form,
  InputNumber,
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
} from 'antd';
import {
  AuditOutlined,
  BellOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import {
  SCORE_DIMENSIONS,
  calcGrade,
  POSITION_TYPES,
  findLabel,
  findPositionLabel,
  findBranchLabel,
} from '../lib/constants';
import { listEvaluations, reviewEvaluation } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function Review() {
  const { user } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('pending');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null); // 当前审核的记录
  const [form] = Form.useForm();

  // 管理员只负责审核自己所属党支部的员工
  const scopeBranch = user?.branch;

  // 当前年度的待审/已审核数量（不受 status 切换影响）
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);

  const reload = async () => {
    setLoading(true);
    try {
      const [data, p, r] = await Promise.all([
        listEvaluations({ year, status, keyword, branch: scopeBranch }),
        listEvaluations({ year, status: 'pending', branch: scopeBranch }),
        listEvaluations({ year, status: 'reviewed', branch: scopeBranch }),
      ]);
      setList(data);
      setPendingCount(p.length);
      setReviewedCount(r.length);
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
  }, [year, status]);

  const openReview = (rec) => {
    setActive(rec);
    form.setFieldsValue({
      reviewScore: rec.selfTotal,
      reviewComment: '',
    });
  };

  const submitReview = async () => {
    try {
      const values = await form.validateFields();
      await reviewEvaluation(active.id, {
        ...values,
        reviewerName: user?.name || '审核人',
      });
      message.success('审核已保存');
      setActive(null);
      reload();
    } catch (e) {
      if (e?.errorFields) message.warning('请填写完整的审核信息');
      else message.error('保存失败');
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', width: 100 },
    {
      title: '岗位 / 类型',
      width: 200,
      render: (_, r) =>
        `${findPositionLabel(r.position)} / ${findLabel(POSITION_TYPES, r.positionType)}`,
    },
    {
      title: '党支部',
      dataIndex: 'partyBranch',
      width: 140,
      render: (v) => findBranchLabel(v),
    },
    {
      title: '自评总分',
      dataIndex: 'selfTotal',
      width: 100,
      render: (v) => <Tag color={v >= 75 ? 'blue' : 'red'}>{v} 分</Tag>,
    },
    {
      title: '自评等级',
      dataIndex: 'selfGrade',
      width: 90,
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 160,
    },
    {
      title: '状态',
      dataIndex: 'reviewStatus',
      width: 100,
      render: (s) =>
        s === 'reviewed' ? <Tag color="green">已审核</Tag> : <Tag color="orange">待审核</Tag>,
    },
    {
      title: '操作',
      width: 120,
      render: (_, rec) => (
        <Button type="link" onClick={() => openReview(rec)}>
          {rec.reviewStatus === 'reviewed' ? '查看 / 重审' : '审核'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      {/* 审核模式 banner */}
      <Alert
        type="warning"
        showIcon
        icon={<AuditOutlined />}
        message={
          <Space>
            <span style={{ fontWeight: 600 }}>管理员审核模式</span>
            <Tag color="red">{user?.name}</Tag>
            <Tag color="gold">
              负责审核：{findBranchLabel(scopeBranch)}
            </Tag>
          </Space>
        }
        description={`您负责审核「${findBranchLabel(
          scopeBranch
        )}」的员工自评。此处仅显示该支部员工，其他支部的数据不可见。`}
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <BellOutlined />
                  <span>{year} 年待审核</span>
                </Space>
              }
              value={pendingCount}
              suffix="人"
              valueStyle={{ color: pendingCount > 0 ? '#cf1322' : '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                <Space>
                  <TrophyOutlined />
                  <span>{year} 年已审核</span>
                </Space>
              }
              value={reviewedCount}
              suffix="人"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="当前列表"
              value={list.length}
              suffix="人"
              valueStyle={{ color: '#b71c1c' }}
            />
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
          style={{ width: 120 }}
          options={[
            { value: 2026, label: 2026 },
            { value: 2025, label: 2025 },
            { value: 2024, label: 2024 },
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
          onSearch={(v) => {
            setKeyword(v);
            reload();
          }}
        />
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        locale={{ emptyText: <Empty description="暂无数据" /> }}
        pagination={{ pageSize: 10 }}
      />

      <Drawer
        title={active ? `审核：${active.name}（${active.year} 年度）` : '审核'}
        open={!!active}
        onClose={() => setActive(null)}
        width={560}
        footer={
          active && (
            <Space>
              <Button onClick={() => setActive(null)}>取消</Button>
              <Button type="primary" onClick={submitReview}>
                确认提交
              </Button>
            </Space>
          )
        }
      >
        {active && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="姓名">{active.name}</Descriptions.Item>
              <Descriptions.Item label="岗位 / 类型">
                {findPositionLabel(active.position)} / {findLabel(POSITION_TYPES, active.positionType)}
              </Descriptions.Item>
              <Descriptions.Item label="党支部">{findBranchLabel(active.partyBranch)}</Descriptions.Item>
              <Descriptions.Item label="年度">{active.year}</Descriptions.Item>
              <Descriptions.Item label="提交时间" span={2}>{active.createdAt}</Descriptions.Item>
            </Descriptions>

            <div className="section-title">党员自评分项</div>
            <Descriptions size="small" column={1} bordered>
              {SCORE_DIMENSIONS.map((d) => (
                <Descriptions.Item key={d.key} label={`${d.label}（满分 ${d.max}）`}>
                  {active.scores?.[d.key] ?? 0} 分
                </Descriptions.Item>
              ))}
              <Descriptions.Item label="自评总分">
                <Tag color="blue">{active.selfTotal}</Tag>
                <Tag>{active.selfGrade}</Tag>
              </Descriptions.Item>
            </Descriptions>

            <div className="section-title">自评总结</div>
            <div style={{ background: '#fafafa', padding: 12, borderRadius: 6 }}>
              {active.selfContent || <span className="muted">（党员未填写）</span>}
            </div>

            <div className="section-title">审核评分</div>
            <Form form={form} layout="vertical">
              <Form.Item
                name="reviewScore"
                label="审核总分（0-100）"
                rules={[
                  { required: true, message: '请填写审核分' },
                  { type: 'number', min: 0, max: 100 },
                ]}
              >
                <InputNumber min={0} max={100} style={{ width: 200 }} addonAfter="/ 100" />
              </Form.Item>
              <Form.Item
                name="reviewComment"
                label="审核评语"
                rules={[{ required: true, message: '请填写评语', min: 10 }]}
              >
                <Input.TextArea rows={4} placeholder="不少于 10 字" showCount />
              </Form.Item>
            </Form>

            <Statistic
              title="当前等级（按审核分）"
              value={calcGrade(form.getFieldValue('reviewScore') || 0)}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}