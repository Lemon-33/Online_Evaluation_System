import { Card, Col, Row, Space, Tag, Typography, Button, Alert } from 'antd';
import {
  EditOutlined,
  FileTextOutlined,
  RiseOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { POSITION_TYPES, findLabel, findPositionLabel } from '../lib/constants';
import { useAuth } from '../context/AuthContext';

const { Text, Paragraph } = Typography;

// 党员自我评价提交（普通党员 / 组织委员的提交类工作总入口）
// ------------------------------------------------------------
// 登录后默认进这一页，里面用两张卡分别进：
//   ① 履职贡献自评提交 → /self（每月一次，已上线）
//   ② 年度专项加分申请提交 → /credit-apply（一年一次，已上线；页面内选年度）
// 之所以做这个总入口而不是把两个模块直接堆在侧边栏：
//   一年只申报一次的「年度专项加分」常驻侧边栏太浪费，收在这里更清爽，
//   而且提交类工作集中在一处，用户不用在侧边栏里找两个入口。
export default function SelfCenter() {
  const { user } = useAuth();
  const nav = useNavigate();
  const now = dayjs();
  const year = now.year();
  const month = now.month() + 1;

  // ① 履职贡献自评：进自评页并锁定当前年月（与「个人积分查询」里的入口一致）
  const goSelfEval = () => nav('/self', { state: { year, month } });
  // ② 年度专项加分申报：进申报页（一年一次，页面内选年度）
  const goCreditApply = () => nav('/credit-apply');

  return (
    <div>
      <Alert
        type="info"
        showIcon
        icon={<UserOutlined />}
        message={
          <Space wrap>
            <span style={{ fontWeight: 600 }}>党员自我评价提交</span>
            {/* 人名统一黑色显示 */}
            <Tag color="default" style={{ color: '#000' }}>
              {user?.name}
            </Tag>
            <Tag color="purple">
              {findPositionLabel(user?.position)} · {findLabel(POSITION_TYPES, user?.positionType)}
            </Tag>
          </Space>
        }
        description="这里是你本人需要提交的评价内容：履职贡献自评每月一次，年度专项加分一年一次。完成后可在「个人积分查询」中查看自己的得分。"
        style={{ marginBottom: 16 }}
      />

      <Row gutter={16}>
        {/* ① 履职贡献自评提交（已上线） */}
        <Col xs={24} md={12}>
          <Card style={{ height: '100%' }}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <EditOutlined style={{ fontSize: 40, color: '#1677ff' }} />
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 12 }}>
                履职贡献自评提交
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                每月提交一次
              </Text>
            </div>
            <Paragraph style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)', minHeight: 66 }}>
              按当前岗位填写本月履职情况（含加分事项与具体事由），提交后由审核人核定；
              审核完成前可以修改，审核完成后锁定。
            </Paragraph>
            <div style={{ textAlign: 'center' }}>
              <Button type="primary" icon={<FileTextOutlined />} onClick={goSelfEval}>
                进入提交
              </Button>
            </div>
          </Card>
        </Col>

        {/* ② 年度专项加分申请提交（一年一次） */}
        <Col xs={24} md={12}>
          <Card style={{ height: '100%' }}>
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <RiseOutlined style={{ fontSize: 40, color: '#3f8600' }} />
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 12 }}>
                年度专项加分申请提交
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                一年申报一次
              </Text>
            </div>
            <Paragraph style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)', minHeight: 66 }}>
              申报本年度获得的荣誉表彰、技能竞赛、创新成果等加分事项，
              由分管领导 / 支部书记核定后计入年度总分。
            </Paragraph>
            <div style={{ textAlign: 'center' }}>
              <Button type="primary" icon={<RiseOutlined />} onClick={goCreditApply}>
                进入提交
              </Button>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
