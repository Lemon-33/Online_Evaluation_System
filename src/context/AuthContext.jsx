import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ROLES } from '../lib/constants';
import { registerUser, loginUser } from '../lib/userService';

const AuthContext = createContext(null);

const SESSION_KEY = 'party_evaluation_session'; // 当前登录用户（本地会话缓存）

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSession);

  // session 持久化：刷新页面不用重新登录
  useEffect(() => {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  }, [user]);

  // ---------- 注册（写入 SQLite） ----------
  const register = async ({
    username,
    password,
    name: realName,
    role,
    position,
    positionType,
    branch,
    adminCode,
  }) => {
    if (!username || !password || !realName || !role) {
      throw new Error('请填写完整的注册信息');
    }
    if (role === ROLES.EMPLOYEE && (!position || !positionType)) {
      throw new Error('员工必须选择岗位类型和所在岗位');
    }
    // 前端只校验"填了没"，密钥正确与否由后端判定（前端源码会打包公开，不能存密钥）
    if (role === ROLES.ADMIN && !adminCode) {
      throw new Error('请输入管理员密钥');
    }
    if (!branch) {
      throw new Error('必须选择所在党支部');
    }

    let res;
    try {
      res = await registerUser({
        username,
        password,
        name: realName,
        role,
        position,
        positionType,
        branch,
        adminCode,
      });
    } catch (e) {
      throw new Error(e.message || '网络异常，注册失败，请稍后重试');
    }

    // 后端判定：管理员密钥不正确
    if (res.code === 'BAD_ADMIN_CODE') {
      throw new Error('管理员密钥不正确');
    }
    // 数据库已存在同名 user_id
    if (res.code === 'USER_EXISTS') {
      throw new Error('用户名已经存在，请选择一个新的用户名');
    }
    if (res.code !== 'OK' || !res.user) {
      throw new Error(res.message || '注册失败，请稍后重试');
    }
    return res.user;
  };

  // ---------- 登录（查询 PostgreSQL） ----------
  const login = async ({ username, password }) => {
    let res;
    try {
      res = await loginUser({ username, password });
    } catch (e) {
      throw new Error(e.message || '网络异常，登录失败，请稍后重试');
    }
    if (res.code !== 'OK' || !res.user) return null;
    setUser(res.user);
    return res.user;
  };

  const logout = () => setUser(null);

  const value = useMemo(
    () => ({
      user,
      isAuthed: !!user,
      role: user?.role,
      register,
      login,
      logout,
      // 权限判断
      can: (action) => {
        if (!user) return false;
        const r = user.role;
        if (action === 'self') return r === ROLES.EMPLOYEE; // 员工才能自评
        if (action === 'review') return r === ROLES.ADMIN; // 仅管理员可审核
        if (action === 'list') return r === ROLES.ADMIN;
        if (action === 'export') return r === ROLES.ADMIN;
        return false;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
