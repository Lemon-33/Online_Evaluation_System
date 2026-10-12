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
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  TrophyOutlined,
  StarFilled,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SCORE_DIMENSIONS,
  calcTotal,
  calcGrade,
  POSITION_TYPES,
  BRANCHES,
  findLabel,
  findPositionLabel,
} from '../lib/constants';
import { getMyEvaluation, submitSelfEvaluation } from '../lib/cloudbase';
import { useAuth } from '../context/AuthContext';

export default function SelfEvaluation() {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [year, setYear] = useState(dayjs().year());
  const [existing, setExisting] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [scores, setScores] = useState({});
  const [loaded, setLoaded] = useState(false);

  const years = useMemo(() => {
    const now = dayjs().year();
    return [now, now - 1, now + 1];
  }, []);

  const reload = async (y) => {
    if (!user?.name) return;
    const rec = await getMyEvaluation(user.name, y);
    setExisting(rec);
    if (rec) {
      form.setFieldsValue({
        selfContent: rec.selfContent,
        partyBranch: user?.branch || rec.partyBranch || '',
        scores: rec.scores || {},
      });
      setScores(rec.scores || {});
    } else {
      form.setFieldsValue({
        selfContent: '',
        partyBranch: user?.branch || '',
        scores: {},
      });
      setScores({});
    }
    setLoaded(true);
  };

  useEffect(() => {
    reload(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, user]);

  const watchedScores = Form.useWatch('scores', form) || scores;
  const total = calcTotal(watchedScores);

  const onSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await submitSelfEvaluation({
        ...values,
        name: user.name,
        position: user.position,
        positionType: user.positionType,
        branch: user.branch, // 所属党支部（注册时确定）
        year,
      });
      message.success('自评提交成功，等待审核');
      reload(year);
    } catch (e) {
      if (e?.errorFields) {
        message.warning('请检查表单填写是否完整');
      } else {
        console.error(e);
        message.error('提交失败，请稍后再试');
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
                  您在 {year} 年度还没有自评记录
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
            <Card title="基本信息">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="姓名">
                    <Input value={user?.name} disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="身份">
                    <Input value="员工（党员）" disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="岗位类型">
                    <Input
                      value={findLabel(POSITION_TYPES, user?.positionType)}
                      disabled
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="所在岗位">
                    <Input value={findPositionLabel(user?.position)} disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label="所在党支部"
                    name="partyBranch"
                    rules={[{ required: true, message: '请选择党支部' }]}
                    extra="取自注册时选择的所属党支部，不可修改"
                  >
                    <Select
                      options={BRANCHES}
                      disabled={!!user?.branch}
                      placeholder="请在注册时选择所属党支部"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

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

            <Card title="自评总结" style={{ marginTop: 16 }}>
              <Form.Item
                label="本年度思想、工作、作风等方面自评总结"
                name="selfContent"
                rules={[{ required: true, message: '请填写自评总结', min: 20 }]}
              >
                <Input.TextArea rows={6} placeholder="不少于 20 字" showCount />
              </Form.Item>
            </Card>
          </Col>

          <Col span={8}>
            <Card
              className="score-card"
              title={
                <Space>
                  <StarFilled style={{ color: '#faad14' }} />
                  <span>我的自评总分</span>
                </Space>
              }
            >
              <Statistic
                value={total}
                suffix="/ 100"
                valueStyle={{
                  color: total >= 75 ? '#3f8600' : total >= 60 ? '#faad14' : '#cf1322',
                  fontSize: 36,
                }}
              />
              <div style={{ marginTop: 12 }}>
                <Tag
                  icon={total >= 60 ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
                  color={total >= 90 ? 'green' : total >= 75 ? 'blue' : total >= 60 ? 'gold' : 'red'}
                  style={{ fontSize: 16, padding: '4px 12px' }}
                >
                  自评等级：{calcGrade(total)}
                </Tag>
              </div>
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
                disabled={locked}
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
                  suffix="/ 100"
                  valueStyle={{ color: '#3f8600', fontSize: 32 }}
                />
                <div style={{ marginTop: 12 }}>
                  <Tag color="green" style={{ fontSize: 16, padding: '4px 12px' }}>
                    {calcGrade(existing.reviewScore || 0)}
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
                  suffix="/ 100"
                />
                <div style={{ marginTop: 8 }}>
                  <Tag color="blue">{calcGrade(existing.selfTotal || 0)}</Tag>
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