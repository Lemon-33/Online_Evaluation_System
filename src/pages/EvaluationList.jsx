import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Tag,
  Space,
  Select,
  Button,
  Input,
  Card,
  Statistic,
  Row,
  Col,
  message,
  Popconfirm,
  Tooltip,
  Alert,
} from 'antd';
import {
  DownloadOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { listEvaluations, deleteEvaluation } from '../lib/cloudbase';
import { exportEvaluationsToExcel } from '../lib/excel';
import { SCORE_DIMENSIONS, calcGrade, POSITION_TYPES, findLabel, findPositionLabel, findBranchLabel } from '../lib/constants';
import { useAuth } from '../context/AuthContext';

export default function EvaluationList() {
  const { can, user } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  // 管理员只查看/导出自己负责审核的党支部
  const scopeBranch = user?.branch;

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listEvaluations({ year, status, keyword, branch: scopeBranch });
      setList(data);
    } catch (e) {
      console.error(e);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, status]);

  const stats = useMemo(() => {
    const total = list.length;
    const reviewed = list.filter((x) => x.reviewStatus === 'reviewed').length;
    const avgSelf = total
      ? (list.reduce((s, x) => s + Number(x.selfTotal || 0), 0) / total).toFixed(1)
      : 0;
    const avgReview = list.filter((x) => x.reviewScore != null).length
      ? (
          list.reduce((s, x) => s + Number(x.reviewScore || 0), 0) /
          list.filter((x) => x.reviewScore != null).length
        ).toFixed(1)
      : 0;
    return { total, reviewed, avgSelf, avgReview };
  }, [list]);

  const onExport = () => {
    if (!list.length) {
      message.warning('当前筛选结果为空，无法导出');
      return;
    }
    exportEvaluationsToExcel(list, year);
    message.success('Excel 已生成');
  };

  const onDelete = async (id) => {
    await deleteEvaluation(id);
    message.success('已删除');
    reload();
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
    { title: '年度', dataIndex: 'year', width: 80 },
    {
      title: '自评分',
      dataIndex: 'selfTotal',
      width: 90,
      render: (v) => (v != null ? `${v}` : '-'),
    },
    {
      title: '自评等级',
      dataIndex: 'selfGrade',
      width: 90,
      render: (g) => g && <Tag color={g === '优秀' ? 'green' : g === '良好' ? 'blue' : 'orange'}>{g}</Tag>,
    },
    {
      title: '审核分',
      dataIndex: 'reviewScore',
      width: 90,
      render: (v, r) =>
        r.reviewStatus === 'reviewed' ? (
          <Tag color={v >= 75 ? 'green' : 'red'}>{v}</Tag>
        ) : (
          <span className="muted">-</span>
        ),
    },
    {
      title: '审核等级',
      width: 90,
      render: (_, r) =>
        r.reviewStatus === 'reviewed' ? (
          <Tag>{calcGrade(r.reviewScore || 0)}</Tag>
        ) : (
          <span className="muted">-</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'reviewStatus',
      width: 90,
      render: (s) =>
        s === 'reviewed' ? <Tag color="green">已审核</Tag> : <Tag color="orange">待审核</Tag>,
    },
    { title: '审核人', dataIndex: 'reviewerName', width: 100 },
    { title: '提交时间', dataIndex: 'createdAt', width: 160 },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, r) =>
        can('export') && (
          <Popconfirm
            title="确定删除该条评价？"
            okType="danger"
            onConfirm={() => onDelete(r.id)}
          >
            <Tooltip title="删除">
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        ),
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`当前仅展示「${findBranchLabel(scopeBranch)}」的党员评价数据（按您的负责范围过滤）`}
      />
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Statistic title="评价总人数" value={stats.total} suffix="人" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="已审核" value={stats.reviewed} suffix="人" valueStyle={{ color: '#3f8600' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="自评平均分" value={stats.avgSelf} suffix="/ 100" /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="审核平均分" value={stats.avgReview} suffix="/ 100" valueStyle={{ color: '#b71c1c' }} /></Card>
        </Col>
      </Row>

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
            { value: '', label: '全部' },
            { value: 'pending', label: '待审核' },
            { value: 'reviewed', label: '已审核' },
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
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        {can('export') && (
          <Button type="primary" icon={<DownloadOutlined />} onClick={onExport}>
            导出 Excel
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        summary={(pageData) => {
          if (!pageData.length) return null;
          const sumRow = (
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
              <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={2}>
                {pageData.length} 人
              </Table.Summary.Cell>
              {SCORE_DIMENSIONS.map((d, i) => (
                <Table.Summary.Cell key={d.key} index={2 + i}>
                  {(
                    pageData.reduce((s, x) => s + Number(x.scores?.[d.key] || 0), 0) /
                    pageData.length
                  ).toFixed(1)}
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={7} colSpan={3}>
                自评均分：
                {(
                  pageData.reduce((s, x) => s + Number(x.selfTotal || 0), 0) /
                  pageData.length
                ).toFixed(1)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
          return <Table.Summary fixed>{sumRow}</Table.Summary>;
        }}
      />
    </div>
  );
}