import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Alert } from 'antd';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import SelfEvaluation from './pages/SelfEvaluation';
import Review from './pages/Review';
import ReviewForm from './pages/ReviewForm';
import BasicRating from './pages/BasicRating';
import DeductionRating from './pages/DeductionRating';
import BasicRatingView from './pages/BasicRatingView';
import ScoreQuery from './pages/ScoreQuery';
import ScoreSummary from './pages/ScoreSummary';
import RedlineReview from './pages/RedlineReview';
import RedlineRating from './pages/RedlineRating';
import RedlineView from './pages/RedlineView';
import CreditReview from './pages/CreditReview';
import CreditReviewForm from './pages/CreditReviewForm';
import SelfCenter from './pages/SelfCenter';
import CreditApply from './pages/CreditApply';
import Profile from './pages/Profile';
import Backdoor from './pages/Backdoor';
import FormOverride from './pages/FormOverride';
import UserAdmin from './pages/UserAdmin';
import ReviewAssign from './pages/ReviewAssign';
import { useAuth } from './context/AuthContext';
import { homePath } from './lib/constants';

// 未登录 → 跳 /login
function RequireAuth({ children }) {
  const { isAuthed } = useAuth();
  const loc = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return children;
}

// 登录后按身份进入各自的工作台（落页规则见 constants.homePath）
function RootRedirect() {
  const { user, isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <Navigate to={homePath(user)} replace />;
}

// 角色路由守卫：无权限 → 静默重定向到本身份工作台主页
function RequireRole({ perm, children }) {
  const { can, user } = useAuth();
  if (can(perm)) return children;
  return <Navigate to={homePath(user)} replace />;
}

export default function App({ mockMode }) {
  return (
    <>
      {mockMode && (
        <Alert
          banner
          type="warning"
          showIcon
          message="当前为 Mock 模式：数据保存在浏览器 localStorage，不会同步到 CloudBase。"
          style={{ borderRadius: 0 }}
        />
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* 忘记用户名 / 密码：未登录即可访问的两步式自助找回 */}
        <Route path="/forgot" element={<ForgotPassword />} />
        {/* 后门维护工具：独立布局，内部自检 admin_type=9 */}
        <Route path="/backdoor" element={<Backdoor />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          {/* 党员自我评价提交：普通党员 / 组织委员登录后默认进这里（提交类工作总入口） */}
          <Route
            path="/self-center"
            element={
              <RequireRole perm="selfCenter">
                <SelfCenter />
              </RequireRole>
            }
          />
          <Route
            path="/self"
            element={
              <RequireRole perm="self">
                <SelfEvaluation />
              </RequireRole>
            }
          />
          {/* 个人积分查询：员工自用，管理员也能进（后续做全量排名时调用） */}
          <Route
            path="/score-query"
            element={
              <RequireRole perm="scoreQuery">
                <ScoreQuery />
              </RequireRole>
            }
          />
          {/* 积分汇总：仅组织委员，按月 / 按年汇总本支部所有人的分数 */}
          <Route
            path="/score-summary"
            element={
              <RequireRole perm="scoreSummary">
                <ScoreSummary />
              </RequireRole>
            }
          />
          {/* 基础积分评价详情：入口不是侧边栏常驻菜单，
              而是「个人积分查询 → 选某月 → 查看评价」，所以路由必须带 :year/:month
              （不带参数的旧兼容路由已删除：当前仍在测试期，没有老用户/老书签） */}
          <Route
            path="/basic-rating-view/:year/:month"
            element={
              <RequireRole perm="basicRatingView">
                <BasicRatingView />
              </RequireRole>
            }
          />
          {/* 年度红线扣分详情：本人只读看自己某一年的红线卷子
              入口是「个人积分查询 → 全年 → 年度红线扣分 → 查看评价」，路由必须带 :year */}
          <Route
            path="/redline-view/:year"
            element={
              <RequireRole perm="scoreQuery">
                <RedlineView />
              </RequireRole>
            }
          />
          <Route
            path="/review"
            element={
              <RequireRole perm="review">
                <Review />
              </RequireRole>
            }
          />
          {/* 整页审核表单：按记录 id 定位（从审核列表「审核」按钮进入） */}
          <Route
            path="/review-form/:id"
            element={
              <RequireRole perm="review">
                <ReviewForm />
              </RequireRole>
            }
          />
          {/* 原「评价汇总」页 /list 已于 2026-10-15 下线（汇总口径待重做）。
              页面文件 src/pages/EvaluationList.jsx 保留备用，重新启用时在此加回路由 + perm="list"。 */}
          <Route
            path="/basic-rating"
            element={
              <RequireRole perm="basicRating">
                <BasicRating />
              </RequireRole>
            }
          />
          <Route
            path="/basic-rating/deduct/:id"
            element={
              <RequireRole perm="deductRating">
                <DeductionRating />
              </RequireRole>
            }
          />
          {/* 年度红线扣分审核（分管领导）：列表 + 问卷页 */}
          <Route
            path="/redline-review"
            element={
              <RequireRole perm="redline">
                <RedlineReview />
              </RequireRole>
            }
          />
          <Route
            path="/redline-review/:id"
            element={
              <RequireRole perm="redline">
                <RedlineRating />
              </RequireRole>
            }
          />
          {/* 年度专项加分申报（员工本人，一年一次）：从「党员自我评价提交」进入 */}
          <Route
            path="/credit-apply"
            element={
              <RequireRole perm="selfCenter">
                <CreditApply />
              </RequireRole>
            }
          />
          {/* 年度专项加分审核（分管领导 / 支部书记）：列表 + 单条审核页 */}
          <Route
            path="/credit-review"
            element={
              <RequireRole perm="creditReview">
                <CreditReview />
              </RequireRole>
            }
          />
          <Route
            path="/credit-review/:id"
            element={
              <RequireRole perm="creditReview">
                <CreditReviewForm />
              </RequireRole>
            }
          />
          {/* 年度红线扣分详情（本人只读）：从「个人积分查询 → 全年 → 查看评价」进入 */}
          {/* ===== 系统维护工具：三个都是复用 /backdoor 里已有的实现 =====
              默认不授权给任何账号（can(...) 恒为 false），入口对所有人隐藏；
              授权由系统管理员在 /backdoor →「权限管理」页维护（permission 表） */}
          <Route
            path="/user-admin"
            element={
              <RequireRole perm="userAdmin">
                <UserAdmin />
              </RequireRole>
            }
          />
          <Route
            path="/review-assign"
            element={
              <RequireRole perm="reviewAssign">
                <ReviewAssign />
              </RequireRole>
            }
          />
          <Route
            path="/form-override"
            element={
              <RequireRole perm="formOverride">
                <FormOverride />
              </RequireRole>
            }
          />
          {/* 个人信息：登录即可查看，与角色无关 */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Route>
      </Routes>
    </>
  );
}