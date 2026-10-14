// 用户数据层：注册 / 登录
//
// 真实模式：调用自建后端 /api/register、/api/login（Express + SQLite）
// 降级模式：VITE_USE_MOCK=true 时用 localStorage 模拟，
//          结构与真实一致（同样是 snake_case），保证两种模式行为统一。

import { apiRequest, isMockMode, setToken, clearToken } from './cloudbase';
import { ROLES, ADMIN_TYPE_EMPLOYEE } from './constants';

const MOCK_KEY = 'mock_user_table';

// ---------- mock 实现 ----------
// 内置一个默认管理员，方便首次本地调试
const DEFAULT_MOCK_USERS = [
  {
    id: 'mock-admin-default',
    user_id: 'admin',
    pw: 'admin123',
    work_id: '000001',
    admin_type: 2, // 支部书记
    name: '默认支书',
    type: null,
    job: null,
    branch: 'first',
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

const readMock = () => {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (!raw) {
      localStorage.setItem(MOCK_KEY, JSON.stringify(DEFAULT_MOCK_USERS));
      return [...DEFAULT_MOCK_USERS];
    }
    return JSON.parse(raw);
  } catch {
    return [...DEFAULT_MOCK_USERS];
  }
};
const writeMock = (list) => localStorage.setItem(MOCK_KEY, JSON.stringify(list));

// 后端返回的字段里本就不含 pw，mock 这里对齐一下
const stripPw = ({ pw, ...rest }) => rest;

const mockRegister = (payload) => {
  const list = readMock();
  // 重名检测（对应数据库里的 PRIMARY KEY 约束）
  if (list.some((u) => u.user_id === payload.user_id)) {
    return { code: 'USER_EXISTS', message: '用户名已经存在，请选择一个新的用户名' };
  }
  // 工作证编号 work_id 全局唯一
  if (payload.work_id && list.some((u) => u.work_id === payload.work_id)) {
    return { code: 'DUP_WORK_ID', message: '当前工号员工已经注册' };
  }
  const row = {
    id: `mock-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    ...payload,
    created_at: new Date().toISOString(),
  };
  list.push(row);
  writeMock(list);
  return { code: 'OK', user: stripPw(row) };
};

const mockLogin = ({ user_id, pw }) => {
  const row = readMock().find((u) => u.user_id === user_id && u.pw === pw);
  if (!row) return { code: 'BAD_CREDENTIALS', message: '账号或密码错误' };
  return { code: 'OK', user: stripPw(row) };
};

// ---------- 字段映射 ----------
// 数据库列（snake_case）→ 前端 user 对象（camelCase）
// 保持前端 user 结构不变，其他页面（自评 / 审核 / 汇总）无需改动
export function mapUserFromDb(row) {
  if (!row) return null;
  // 身份完全由 admin_type 决定（0=分管领导 1=组织委员 2=支部书记 3=普通党员）
  const adminType =
    row.admin_type == null ? ADMIN_TYPE_EMPLOYEE : Number(row.admin_type);
  // 兼容旧页面的 role 判断：只有普通党员算 employee，其余视为审核端(admin)
  const role = adminType === ADMIN_TYPE_EMPLOYEE ? ROLES.EMPLOYEE : ROLES.ADMIN;
  return {
    id: row.id,
    username: row.user_id,
    name: row.name,
    workId: row.work_id || '',
    role,
    adminType,
    hasReviewTargets: !!row.hasReviewTargets,
    position: row.job || '',
    positionType: row.type || '',
    branch: row.branch || '',
    createdAt: row.created_at,
  };
}

// 前端注册表单 → 数据库列
// 注意：admin_type 由后端按 work_id 白名单决定后写入，前端不再传 role
export function toDbPayload({ username, password, name, workId, position, positionType, branch }) {
  return {
    user_id: username,
    pw: password,
    name,
    work_id: workId,
    type: positionType,
    job: position,
    branch,
  };
}

// ---------- 对外接口：注册 ----------
// 前端只提交表单字段；身份（admin_type）由后端按 work_id 白名单决定并落库，
// 岗位类型是否必填也由后端判定。前端不做预校验。
// 注册**不签发会话**：成功后需重新登录（故这里不 setToken）。
export async function registerUser(values) {
  const payload = toDbPayload(values);

  if (isMockMode()) {
    // mock 模式无后端白名单：一律按普通党员(3)落库，便于本地跑通
    const row = { ...payload, admin_type: ADMIN_TYPE_EMPLOYEE };
    const res = mockRegister(row);
    return { ...res, user: mapUserFromDb(res.user) };
  }

  const result = await apiRequest('/api/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { ...result, user: mapUserFromDb(result?.user) };
}

// ---------- 对外接口：登录 ----------
export async function loginUser({ username, password }) {
  const payload = { user_id: username, pw: password };

  if (isMockMode()) {
    const res = mockLogin(payload);
    return { ...res, user: mapUserFromDb(res.user) };
  }

  const result = await apiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  // 登录成功 → 保存服务端签发的会话 token
  if (result?.token) setToken(result.token);
  return { ...result, user: mapUserFromDb(result?.user) };
}

// ---------- 后门登录 ----------
//   调 /api/backdoor/login（独立端点，不走普通 /api/login 的"工号必须已注册"校验）。
//   前端只在 username === 'superadmin' 时调用一次（AuthContext.login 负责分流）。
//   失败时只回传后端错误码，不在前端硬编码密码做校验——避免密码散落到前端 bundle。
export async function loginBackdoor({ password }) {
  if (isMockMode()) {
    return { code: 'BAD_CREDENTIALS', message: 'Mock 模式不支持后门登录' };
  }
  const result = await apiRequest('/api/backdoor/login', {
    method: 'POST',
    body: JSON.stringify({ user: 'superadmin', password }),
  });
  if (result?.token) setToken(result.token);
  return { ...result, user: mapUserFromDb(result?.user) };
}

// ---------- 对外接口：退出登录 ----------
// 告知服务端注销会话（token 立即失效），并清掉本地 token。
// 服务端不可达时静默失败 —— 本地 token 照样清，最多服务端会话多活几天自然过期。
export async function logoutUser() {
  if (isMockMode()) return;
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch {
    /* 网络异常不阻塞登出 */
  }
  clearToken();
}
