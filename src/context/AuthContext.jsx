import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ADMIN_TYPE_LEADER,
  ADMIN_TYPE_ORGANIZER,
  ADMIN_TYPE_SECRETARY,
  ADMIN_TYPE_EMPLOYEE,
  ADMIN_TYPE_DIRECTOR,
  ADMIN_TYPE_SYSTEM,
} from '../lib/constants';
import { registerUser, loginUser, loginBackdoor, logoutUser } from '../lib/userService';
import { getMyMenuOrder } from '../lib/cloudbase';

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
  // 个人偏好：侧边栏模块排序（菜单 key 数组；空 = 用默认顺序）
  //   登录后按工号拉取一次；「个人信息」页保存后会同步更新这里，
  //   所以改完顺序侧边栏立即生效，不用刷新页面
  const [menuOrder, setMenuOrder] = useState([]);

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
  }) => {
    // 注：branch 不再由注册页采集 —— 后端按「工作证编号 → 白名单」取所在党支部落库
    if (!username || !password || !realName || !workId) {
      throw new Error('请填写完整的注册信息');
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
    setMenuOrder([]);
  };

  // 拉取本人侧边栏排序偏好（失败就用默认顺序，不影响登录）
  useEffect(() => {
    let cancelled = false;
    const w = String(user?.workId || '').trim();
    if (!w) {
      setMenuOrder([]);
      return undefined;
    }
    (async () => {
      try {
        const order = await getMyMenuOrder();
        if (!cancelled) setMenuOrder(Array.isArray(order) ? order : []);
      } catch {
        if (!cancelled) setMenuOrder([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.workId]);

  const value = useMemo(
    () => ({
      user,
      isAuthed: !!user,
      role: user?.role,
      isBackdoor: user?.adminType === ADMIN_TYPE_SYSTEM,
      menuOrder,       // 本人侧边栏排序（key 数组）
      setMenuOrder,    // 「个人信息」页保存后调用，侧边栏立即生效
      register,
      login,
      logout,
      // 权限判断：身份完全由 adminType 决定
      //   普通党员(3) → 自评 / 查看基础评分 / 个人积分查询 / [有审核对象] 履职积分审核
      //   组织委员(1) → 普通用户全部 + 基础积分评价
      //   分管领导(4) → 履职积分审核（恒有入口，范围=被指派的人；不参与其它任何模块）
      //   支部书记(0) → 履职积分审核
      //   党总支书记(2) → 履职积分审核（恒有入口，范围=被指派的人）+ 基础积分评价（全体）
      can: (action) => {
        if (!user) return false;
        const at = user.adminType;
        const isLeader = at === ADMIN_TYPE_LEADER;
        const isOrganizer = at === ADMIN_TYPE_ORGANIZER;
        const isSecretary = at === ADMIN_TYPE_SECRETARY;
        const isEmployee = at === ADMIN_TYPE_EMPLOYEE;
        const isDirector = at === ADMIN_TYPE_DIRECTOR;
        const selfEval = isOrganizer || isEmployee; // 可提交履职贡献自评
        // 履职积分审核入口：分管领导 / 支部书记 / 党总支书记恒有；其他人被指派了审核对象才有
        //   注意「有入口」≠「有数据」：这些人的审核范围仍完全由 review_assignment 决定，
        //   刚注册时该表为空 → 进得去审核页，但列表是空的
        const canReview = isLeader || isSecretary || isDirector || !!user.hasReviewTargets;

        if (action === 'self') return selfEval;
        // 党员自我评价提交（提交类入口总页）：普通党员 / 组织委员
        if (action === 'selfCenter') return selfEval;
        if (action === 'review') return canReview;
        // 评价汇总(list) / 导出(export)：入口已于 2026-10-15 下线，恒为 false
        //   原因：汇总口径要重做。页面 src/pages/EvaluationList.jsx 与导出逻辑
        //   src/lib/excel.js 保留备用，路由 /list 已移除，后续接新方案时直接复用。
        if (action === 'basicRating') return isOrganizer || isSecretary;
        if (action === 'deductRating') return isOrganizer || isSecretary;
        if (action === 'scoreQuery') return selfEval;      // 个人积分查询（普通用户）
        // 积分汇总：组织委员 / 党总支书记 / 支部书记（可见范围由后端按身份限定）
        if (action === 'scoreSummary') return isOrganizer || isSecretary || isLeader;
        // 支部积分查询：仅分管领导（复用「支部积分汇总」页面，可在两个支部 / 全体成员间切换）
        if (action === 'branchScoreQuery') return isDirector;
        // 年度红线扣分审核：支部书记 / 党总支书记（各自只审自己支部）
        if (action === 'redline') return isLeader || isSecretary;
        // 年度专项加分审核：支部书记 / 党总支书记（数据来自 credit 表，谁申报审谁）
        if (action === 'creditReview') return isLeader || isSecretary;
        if (action === 'basicRatingView') return selfEval; // 查看基础评分（普通用户）
        // 系统维护工具：登录时由后端下发的标记（默认全员 false，即入口对所有账号隐藏）
        //   授权存在后端 permission 表，由系统管理员在 /backdoor →「权限管理」页维护；
        //   授权 / 收回后本人需重新登录一次才会刷新这些标记。
        //   系统管理员不走这里 —— 它用独立布局的 /backdoor（内部自检 admin_type=9）
        if (action === 'userAdmin') return !!user.canUserAdmin;       // 员工信息维护
        if (action === 'reviewAssign') return !!user.canReviewAssign; // 审核关系维护
        if (action === 'formOverride') return !!user.canFormOverride; // 个人问卷维护
        return false;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, menuOrder]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
