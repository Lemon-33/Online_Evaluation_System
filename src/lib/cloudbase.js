// 前端数据访问层：调用自建后端（Express + SQLite）
//
// 架构说明：
//   前端（nginx 静态托管）与后端（Node/Express，路径 /api/*）部署在同一台服务器，
//   生产环境同域，因此 API_BASE 默认为空字符串，直接请求 '/api/...'。
//   本地开发时由 vite.config.js 的 proxy 转发到服务器。
//
// 切换 mock：.env.local 里设 VITE_USE_MOCK=true

import dayjs from 'dayjs';
import { calcTotal, matchBranch, findBranchLabel } from './constants';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const USE_MOCK = String(import.meta.env.VITE_USE_MOCK).toLowerCase() === 'true';

// 保留该函数以兼容 main.jsx 的启动调用（自建后端无需初始化）
export async function initCloudBase() {
  return { mock: USE_MOCK };
}

export const isMockMode = () => USE_MOCK;

// ---------- 通用请求封装 ----------
export async function apiRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('网络异常，无法连接服务器');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应，忽略 */
  }
  if (!res.ok) {
    throw new Error((body && body.message) || `请求失败（HTTP ${res.status}）`);
  }
  return body;
}

// ---------- mock 实现（浏览器 localStorage 持久化） ----------
const MOCK_KEY = 'mock_evaluations';
const readMock = () => {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY) || '[]');
  } catch {
    return [];
  }
};
const writeMock = (list) => localStorage.setItem(MOCK_KEY, JSON.stringify(list));

// ---------- 评价 CRUD ----------

// 党员提交 / 更新自评
export async function submitSelfEvaluation(payload) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const scores = payload.scores || {};
  // 岗位专属表单：总分由页面按所选选项算好传入（selfTotal）；
  // 通用表单：沿用 5 项维度求和
  const total = payload.selfTotal ?? calcTotal(scores);
  const record = {
    name: payload.name,
    // 所属党支部：统一存 value（'first' / 'second'），便于按支部隔离审核范围
    partyBranch: payload.branch || payload.partyBranch,
    year: payload.year,
    // 评价周期精确到月：同一人同年同月只有一条，重复提交覆盖旧的
    month: Number(payload.month) || 1,
    position: payload.position || '',
    positionType: payload.positionType || '',
    scores,
    selfTotal: total,
    reviewStatus: 'pending',
    reviewerName: '',
    reviewScore: null,
    reviewComment: '',
    reviewedAt: '',
    createdAt: now,
    updatedAt: now,
  };

  if (USE_MOCK) {
    const list = readMock();
    const idx = list.findIndex(
      (x) => x.name === payload.name && x.year === payload.year && (x.month || 1) === record.month
    );
    // mock 模拟后端规则：该月已审核 → 锁定，不允许覆盖
    if (idx >= 0 && list[idx].reviewStatus === 'reviewed')
      throw new Error(`${payload.year} 年 ${record.month} 月的自评已审核完成，不能重复提交覆盖`);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...record };
      writeMock(list);
      return { ...list[idx], id: list[idx].id };
    }
    const newRec = { id: `mock-${Date.now()}`, ...record };
    list.push(newRec);
    writeMock(list);
    return newRec;
  }

  const res = await apiRequest('/api/evaluations', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  // 后端判定：该月已审核锁定，拒绝覆盖
  if (res?.code === 'ALREADY_REVIEWED')
    throw new Error(res.message || '该月份自评已审核完成，不能重复提交覆盖');
  // 后端判定：未来月份不允许提交
  if (res?.code === 'FUTURE_MONTH')
    throw new Error(res.message || '提交时间不能晚于当前月份，请修改后重试');
  return { ...record, id: res?.id };
}

// 查询某党员指定年月的自评
export async function getMyEvaluation(name, year, month) {
  const m = Number(month) || 1;
  if (USE_MOCK) {
    const list = readMock();
    return list.find((x) => x.name === name && x.year === year && (x.month || 1) === m) || null;
  }
  const params = { year: String(year), month: String(m), keyword: name };
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/evaluations?${qs}`);
  const list = res?.data || [];
  return list.find((x) => x.name === name) || null;
}

// 评价列表（带筛选）
// branch: 传入党支部 value（'first' / 'second'）时，只返回该支部的评价
// month: 传 1-12 时只返回该月的自评，不传返回全年
export async function listEvaluations({ year, month, status, keyword, branch } = {}) {
  if (USE_MOCK) {
    let list = readMock();
    if (year) list = list.filter((x) => x.year === year);
    if (month) list = list.filter((x) => (x.month || 1) === Number(month));
    if (status) list = list.filter((x) => x.reviewStatus === status);
    if (keyword) list = list.filter((x) => x.name?.includes(keyword));
    if (branch) list = list.filter((x) => matchBranch(x.partyBranch, branch));
    return list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }

  const params = {};
  if (year) params.year = year;
  if (month) params.month = month;
  if (status) params.status = status;
  if (keyword) params.keyword = keyword;
  if (branch) params.branch = branch;
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/evaluations${qs ? `?${qs}` : ''}`);
  return res?.data || [];
}

// 审核（更新审核分 + 评语）
export async function reviewEvaluation(id, { reviewScore, reviewComment, reviewerName }) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const patch = {
    reviewScore,
    reviewComment,
    reviewerName,
    reviewedAt: now,
    reviewStatus: 'reviewed',
    updatedAt: now,
  };
  if (USE_MOCK) {
    const list = readMock();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      writeMock(list);
      return list[idx];
    }
    return null;
  }
  await apiRequest(`/api/evaluations/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ reviewScore, reviewComment, reviewerName }),
  });
  return { id, ...patch };
}

// 删除
export async function deleteEvaluation(id) {
  if (USE_MOCK) {
    const list = readMock().filter((x) => x.id !== id);
    writeMock(list);
    return true;
  }
  await apiRequest(`/api/evaluations/${id}`, { method: 'DELETE' });
  return true;
}

// 兼容旧代码：以前 CloudBase 版本导出的 getApp，现已不再需要
export function getApp() {
  throw new Error('getApp 已废弃：请使用 cloudbase.js 中的 apiRequest');
}
