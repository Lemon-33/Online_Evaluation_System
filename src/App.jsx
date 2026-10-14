import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Alert } from 'antd';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import SelfEvaluation from './pages/SelfEvaluation';
import Review from './pages/Review';
import ReviewForm from './pages/ReviewForm';
import EvaluationList from './pages/EvaluationList';
import BasicRating from './pages/BasicRating';
import DeductionRating from './pages/DeductionRating';
import BasicRatingView from './pages/BasicRatingView';
import ScoreQuery from './pages/ScoreQuery';
import Profile from './pages/Profile';
import Backdoor from './pages/Backdoor';
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
        {/* 后门维护工具：独立布局，内部自检 admin_type=9 */}
        <Route path="/backdoor" element={<Backdoor />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
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
          {/* 基础积分评价查看：员工只读查看自己的扣分问卷结果（仅员工） */}
          <Route
            path="/basic-rating-view"
            element={
              <RequireRole perm="basicRatingView">
                <BasicRatingView />
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
          <Route
            path="/list"
            element={
              <RequireRole perm="list">
                <EvaluationList />
              </RequireRole>
            }
          />
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
          {/* 个人信息：登录即可查看，与角色无关 */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Route>
      </Routes>
    </>
  );
}