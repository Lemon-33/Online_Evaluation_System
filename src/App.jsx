import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Alert } from 'antd';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import SelfEvaluation from './pages/SelfEvaluation';
import Review from './pages/Review';
import EvaluationList from './pages/EvaluationList';
import Profile from './pages/Profile';
import { useAuth } from './context/AuthContext';
import { ROLES } from './lib/constants';

// 未登录 → 跳 /login
function RequireAuth({ children }) {
  const { isAuthed } = useAuth();
  const loc = useLocation();
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  return children;
}

// 登录后按角色进入各自的工作台
function RootRedirect() {
  const { user, isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  // 员工 → 自评模式 / 管理员 → 审核模式
  return (
    <Navigate to={user.role === ROLES.ADMIN ? '/review' : '/self'} replace />
  );
}

// 角色路由守卫：
// - 员工只能进 /self；进 /review、/list 直接重定向走 /self
// - 管理员只能进 /review、/list；进 /self 直接重定向走 /review
function RequireRole({ perm, children }) {
  const { can, user } = useAuth();
  if (can(perm)) return children;

  // 没权限 → 静默重定向到自己角色的主页，不显示错误页
  const fallback = user?.role === ROLES.ADMIN ? '/review' : '/self';
  return <Navigate to={fallback} replace />;
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
          <Route
            path="/review"
            element={
              <RequireRole perm="review">
                <Review />
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
          {/* 个人信息：登录即可查看，与角色无关 */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Route>
      </Routes>
    </>
  );
}