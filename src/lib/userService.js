// 用户数据层：注册 / 登录
//
// 真实模式：调用自建后端 /api/register、/api/login（Express + SQLite）
// 降级模式：VITE_USE_MOCK=true 时用 localStorage 模拟，
//          结构与真实一致（同样是 snake_case），保证两种模式行为统一。

import { apiRequest, isMockMode } from './cloudbase';
import { ROLES } from './constants';

const MOCK_KEY = 'mock_user_table';

// ---------- mock 实现 ----------
// 内置一个默认管理员，方便首次本地调试
const DEFAULT_MOCK_USERS = [
  {
    id: 'mock-admin-default',
    user_id: 'admin',
    pw: 'admin123',
    work_id: 'W-0001',
    admin: true,
    admin_type: 0,
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
  // SQLite 的布尔值存为 0 / 1，这里做兼容
  const isAdmin =
    row.admin === true || row.admin === 1 || row.admin === '1' || row.admin === 'true';
  return {
    id: row.id,
    username: row.user_id,
    name: row.name,
    workId: row.work_id || '',
    role: isAdmin ? ROLES.ADMIN : ROLES.EMPLOYEE,
    adminType: (row.admin_type === 1 || row.admin_type === '1') ? 1 : 0, // 0=分管领导, 1=组织委员
    position: row.job || '',
    positionType: row.type || '',
    branch: row.branch || '',
    createdAt: row.created_at,
  };
}

// 前端注册表单 → 数据库列
// 注意：admin / admin_type 由后端按 role + work_id 共同决定后写入
export function toDbPayload({ username, password, name, workId, role, position, positionType, branch }) {
  return {
    user_id: username,
    pw: password,
    name,
    work_id: workId,
    role, // 'employee' | 'admin' — 后端校验 work_id 与 role 的一致性
    type: positionType,
    job: position,
    branch,
  };
}

// ---------- 对外接口：注册 ----------
// 前端把用户选的 role 传给后端；后端按 work_id 查白名单，并校验
//   - role='admin' 要求 work_id 在白名单前 4
//   - role='employee' 要求 work_id 在白名单非前 4
// 不在前端做预校验。
export async function registerUser(values) {
  const payload = toDbPayload(values);

  if (isMockMode()) {
    // mock 模式无后端校验，按用户选的 role 写入
    const row = {
      ...payload,
      admin: payload.role === ROLES.ADMIN ? 1 : 0,
      admin_type: 0,
    };
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
  return { ...result, user: mapUserFromDb(result?.user) };
}
