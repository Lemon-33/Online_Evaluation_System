// 用户数据层：注册 / 登录
//
// 真实模式：调用 CloudBase 云函数 userService（云函数里用 pg 连 PostgreSQL）
// 降级模式：未配置环境或 VITE_USE_MOCK=true 时，用 localStorage 模拟，
//          结构与真实一致（同样是 snake_case），保证两种模式行为统一。

import { getApp, isMockMode } from './cloudbase';
import { ROLES } from './constants';

const FN_NAME = 'userService';
const MOCK_KEY = 'mock_user_table';

// ---------- mock 实现 ----------
// 内置一个默认管理员，方便首次本地调试
const DEFAULT_MOCK_USERS = [
  {
    id: 'mock-admin-default',
    user_id: 'admin',
    pw: 'admin123',
    admin: true,
    name: '默认管理员',
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

// 云函数返回的字段里本就不含 pw，mock 这里对齐一下
const stripPw = ({ pw, ...rest }) => rest;

const mockRegister = (payload) => {
  const list = readMock();
  // 重名检测（对应数据库里的 UNIQUE 约束）
  if (list.some((u) => u.user_id === payload.user_id)) {
    return { code: 'USER_EXISTS', message: '用户名已经存在，请选择一个新的用户名' };
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
  const isAdmin = row.admin === true || row.admin === 'true';
  return {
    id: row.id,
    username: row.user_id,
    name: row.name,
    role: isAdmin ? ROLES.ADMIN : ROLES.EMPLOYEE,
    position: row.job || '',
    positionType: row.type || '',
    branch: row.branch || '',
    createdAt: row.created_at,
  };
}

// 前端注册表单 → 数据库列
export function toDbPayload({ username, password, name, role, position, positionType, branch }) {
  const isAdmin = role === ROLES.ADMIN;
  return {
    user_id: username,
    pw: password,
    name,
    admin: isAdmin,
    // 管理员不允许写入岗位信息（对应表里的 CHECK 约束）
    type: isAdmin ? null : positionType,
    job: isAdmin ? null : position,
    branch,
  };
}

// ---------- 对外接口：注册 ----------
export async function registerUser(values) {
  const payload = toDbPayload(values);

  if (isMockMode()) {
    const res = mockRegister(payload);
    return { ...res, user: mapUserFromDb(res.user) };
  }

  const { result } = await getApp().callFunction({
    name: FN_NAME,
    data: { action: 'register', payload },
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

  const { result } = await getApp().callFunction({
    name: FN_NAME,
    data: { action: 'login', payload },
  });
  return { ...result, user: mapUserFromDb(result?.user) };
}
