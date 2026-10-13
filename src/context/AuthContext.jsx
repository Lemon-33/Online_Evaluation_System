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
  // 用户在注册页选 role（员工/管理员）→ 后端按 role + work_id 共同校验
  // 员工字段（position/positionType）仅在 role='employee' 时由前端传；
  // role='admin' 时不传岗位字段。
  const register = async ({
    username,
    password,
    name: realName,
    workId,
    role,
    position,
    positionType,
    branch,
  }) => {
    if (!username || !password || !realName || !workId || !role) {
      throw new Error('请填写完整的注册信息');
    }
    if (!branch) {
      throw new Error('必须选择所在党支部');
    }
    if (role === ROLES.EMPLOYEE && (!position || !positionType)) {
      throw new Error('员工必须选择岗位类型和所在岗位');
    }

    let res;
    try {
      res = await registerUser({
        username,
        password,
        name: realName,
        workId,
        role,
        position,
        positionType,
        branch,
      });
    } catch (e) {
      throw new Error(e.message || '网络异常，注册失败，请稍后重试');
    }

    // 后端校验错误码
    if (res.code === 'WORK_ID_NOT_IN_LIST') {
      throw new Error(res.message || '工作证编号异常，请重新输入');
    }
    if (res.code === 'WORK_ID_NOT_ADMIN') {
      throw new Error(res.message || '该工作证编号不是管理员编号，无法注册为管理员');
    }
    if (res.code === 'WORK_ID_IS_ADMIN') {
      throw new Error(res.message || '该工作证编号属于管理员，请用管理员身份注册');
    }
    if (res.code === 'USER_EXISTS') {
      throw new Error('用户名已经存在，请选择一个新的用户名');
    }
    if (res.code === 'DUP_WORK_ID') {
      throw new Error(res.message || '当前工号员工已经注册');
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
