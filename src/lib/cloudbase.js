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

// ---------- 登录态（token）存取 ----------
// 与 AuthContext 的 SESSION_KEY（用户信息缓存）分开存：
//   token   → 服务端 session 表的钥匙，每个请求带在 Authorization 头里
//   session → 前端展示用的用户信息缓存（刷新不掉线）
const TOKEN_KEY = 'party_evaluation_token';
const SESSION_KEY = 'party_evaluation_session';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// ---------- 通用请求封装 ----------
// 所有请求自动带 Authorization: Bearer <token>；
// 401（未登录 / 会话过期）→ 清空本地登录态并跳转登录页
export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('网络异常，无法连接服务器');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 响应，忽略 */
  }
  // 登录态失效：清掉 token + 用户缓存，回登录页重新登录
  // （/api/login 本身不会返回 401，不会死循环）
  if (res.status === 401) {
    clearToken();
    localStorage.removeItem(SESSION_KEY);
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error((body && body.message) || '登录已过期，请重新登录');
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

// mock 场景下按 work_id（优先）或 name 定位同月记录，与服务端查重规则一致
function workIdOrNameIdx(list, { work_id, name, year, month }) {
  const m = Number(month) || 1;
  const isMine = (x) =>
    (work_id ? x.work_id === work_id : !x.work_id && x.name === name) &&
    x.year === year &&
    (x.month || 1) === m;
  return list.findIndex(isMine);
}

// ---------- 评价 CRUD ----------

// 党员提交 / 更新自评
// payload.work_id：员工工号（全局唯一，可区分同名员工）→ 服务端按 work_id 定位记录
export async function submitSelfEvaluation(payload) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const scores = payload.scores || {};
  // 岗位专属表单：总分由页面按所选选项算好传入（selfTotal）；
  // 通用表单：沿用 5 项维度求和
  const total = payload.selfTotal ?? calcTotal(scores);
  const record = {
    name: payload.name,
    // 员工唯一标识（API 协议字段，蛇形）：服务端按此区分同名员工
    work_id: payload.work_id || '',
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
    // mock 匹配规则与服务端一致：有 work_id 按 work_id，否则按 name
    const idx = workIdOrNameIdx(list, payload);
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
// workId：员工工号（可选）。传入时优先按 work_id 匹配，可区分同名员工；
// 未传（旧调用）回落按姓名匹配，行为与之前一致
export async function getMyEvaluation(name, year, month, workId) {
  const m = Number(month) || 1;
  if (USE_MOCK) {
    const list = readMock();
    return (
      list.find(
        (x) => x.year === year && (x.month || 1) === m &&
          (workId ? x.work_id === workId : x.name === name)
      ) || null
    );
  }
  const params = { year: String(year), month: String(m), keyword: name };
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/evaluations?${qs}`);
  const list = res?.data || [];
  // keyword 是模糊搜索：同名员工的记录会一起返回，按 work_id 精确锁定本人；
  // 无 work_id 的旧数据回落按姓名（取第一条）
  return list.find((x) => (workId ? x.work_id === workId : x.name === name)) || null;
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

// 「未提交审核人数」统计：返回 { total, submitted, unsubmitted, list }
//   year / month 必传；branch 可选：
//     - 有值 → 仅统计该支部
//     - 空/缺失 → 统计全支部（支部书记视图）
//   mock 模式下没有 user_table 数据，按「已提交数」倒推一个粗略占位数（仅本地调试用）
export async function getUnsubmittedCount({ year, month, branch } = {}) {
  if (USE_MOCK) {
    let submitted = 0;
    if (branch) {
      submitted = readMock().filter(
        (x) =>
          x.year === Number(year) &&
          (x.month || 1) === Number(month) &&
          matchBranch(x.partyBranch, branch)
      ).length;
      return { total: submitted, submitted, unsubmitted: 0, list: [] };
    }
    submitted = readMock().filter(
      (x) =>
        x.year === Number(year) && (x.month || 1) === Number(month)
    ).length;
    return { total: submitted, submitted, unsubmitted: 0, list: [] };
  }
  const params = { year: String(year), month: String(month) };
  if (branch) params.branch = branch;
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/evaluations/unsubmitted?${qs}`);
  return res?.data || { total: 0, submitted: 0, unsubmitted: 0, list: [] };
}

// 按 id 取单条自评记录（审核表单页定位用）
// 返回 null = 记录不存在（或无权查看时由 apiRequest 抛错）
export async function getEvaluationById(id) {
  if (USE_MOCK) {
    return readMock().find((x) => String(x.id) === String(id)) || null;
  }
  const res = await apiRequest(`/api/evaluations/${id}`);
  return res?.data || null;
}

// 审核（定稿整份答卷）
//   scores       审核版答案：岗位表单 {answers:{...}}（含履职扣分）/ 通用表单 {维度:分}
//   reviewScore  按答卷算出的最终审核分（含负的扣分项）
//   reviewComment 审核理由（未改选项且无扣分时可空，是否必填由页面判定）
//   reviewerName 仅 mock 模式使用；真实接口由服务端从 token 绑定，不传
export async function reviewEvaluation(id, { scores, reviewScore, reviewComment, reviewerName }) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const patch = {
    reviewScore,
    reviewComment,
    reviewerName,
    reviewedAt: now,
    reviewStatus: 'reviewed',
    updatedAt: now,
  };
  if (scores) patch.reviewScores = scores;
  if (USE_MOCK) {
    const list = readMock();
    const idx = list.findIndex((x) => String(x.id) === String(id));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      writeMock(list);
      return list[idx];
    }
    return null;
  }
  await apiRequest(`/api/evaluations/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ scores, reviewScore, reviewComment }),
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

// ---------- 基础积分评价（组织委员 adminType=1） ----------

const RATING_MOCK_KEY = 'mock_ratings';
const readRatingMock = () => {
  try {
    return JSON.parse(localStorage.getItem(RATING_MOCK_KEY) || '[]');
  } catch {
    return [];
  }
};
const writeRatingMock = (list) =>
  localStorage.setItem(RATING_MOCK_KEY, JSON.stringify(list));

// 查询某支部基础积分评价列表（后端会在查询「当前年月」时惰性生成当月记录）
//   year    必填
//   month   可选：不传 / 空 = 全年（与「年度」筛选配合）
//   status  可选：pending / reviewed
//   keyword 可选：按姓名模糊搜索
export async function listRatings({ year, month, branch, status, keyword } = {}) {
  if (USE_MOCK) {
    let list = readRatingMock();
    if (year) list = list.filter((x) => x.year === year);
    if (month) list = list.filter((x) => (x.month || 1) === Number(month));
    if (branch) list = list.filter((x) => matchBranch(x.partyBranch, branch));
    if (status) list = list.filter((x) => x.reviewStatus === status);
    if (keyword) list = list.filter((x) => x.name?.includes(keyword));
    return list;
  }
  const params = { year: String(year), branch };
  // 空月份 = 全年：不带 month 参数
  if (month) params.month = String(month);
  if (status) params.status = status;
  if (keyword) params.keyword = keyword;
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/ratings?${qs}`);
  return res?.data || [];
}

// 组织委员审核某条基础积分记录
export async function reviewRating(id, { reviewScore, reviewComment, reviewerName }) {
  const t = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const patch = {
    reviewScore,
    reviewComment,
    reviewerName,
    reviewedAt: t,
    reviewStatus: 'reviewed',
  };
  if (USE_MOCK) {
    const list = readRatingMock();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      writeRatingMock(list);
      return list[idx];
    }
    return null;
  }
  await apiRequest(`/api/ratings/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ reviewScore, reviewComment, reviewerName }),
  });
  return { id, ...patch };
}

// 组织委员以「扣分问卷」形式评分：
//   scores       每题答案 + 总扣分 + 最终得分（写入 rating.scores JSON 列）
//   reviewScore  最终得分（写入 rating.reviewScore 列）
//   reviewComment 扣分原因（写入 rating.reviewComment 列）
//   work_id      被评分员工的工号（随行携带；老记录 work_id 为空时由服务端回填）
export async function submitDeductionRating(id, payload) {
  const t = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const { scores, reviewScore, reviewComment, reviewerName, work_id } = payload || {};
  const patch = {
    scores,
    reviewScore,
    reviewComment,
    reviewerName,
    reviewedAt: t,
    reviewStatus: 'reviewed',
  };
  if (USE_MOCK) {
    const list = readRatingMock();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch, ...(work_id ? { work_id } : {}) };
      writeRatingMock(list);
      return list[idx];
    }
    return null;
  }
  await apiRequest(`/api/ratings/${id}/extra-deduct-review`, {
    method: 'PATCH',
    body: JSON.stringify({ scores, reviewScore, reviewComment, reviewerName, work_id }),
  });
  return { id, ...patch };
}

// 兼容旧代码：以前 CloudBase 版本导出的 getApp，现已不再需要
// ============================================================
// 个人积分查询（员工自用，函数也可被管理员后续"全成员排名"复用）
// ------------------------------------------------------------
// 数据口径与后端保持一致：
//   - 只统计 reviewStatus='reviewed' 的记录；无记录 / 未审核视为 0
//   - 月度：基础积分 = rating.reviewScore；履职贡献积分 = evaluation.reviewScore
//   - 全年：已审核月份的均分（缺月不计入分母）+ 创新加分（credit）+ 红线扣分（discipline）
// 入参 workId / name 必传其一以定位员工。
//   员工调用：服务端会强制覆盖为本人（不能查别人）
//   管理员调用：传任意员工的 workId/name
// ============================================================

// 月度积分 → { basic, contribution, total }
export async function getMemberMonthlyScores({ year, month, workId, name } = {}) {
  if (USE_MOCK) {
    return { basic: 0, contribution: 0, total: 0 };
  }
  const params = new URLSearchParams();
  params.set('year', String(year));
  params.set('month', String(month));
  if (workId) params.set('work_id', String(workId));
  if (name)   params.set('name', String(name));
  const res = await apiRequest(`/api/scores/monthly?${params}`);
  return (
    res?.data || {
      basic: 0,
      contribution: 0,
      total: 0,
    }
  );
}

// 全年积分 → { basicAvg, contributionAvg, credit, discipline, total }
export async function getMemberAnnualScores({ year, workId, name } = {}) {
  if (USE_MOCK) {
    return {
      basicAvg: 0,
      contributionAvg: 0,
      credit: 0,
      discipline: 0,
      total: 0,
    };
  }
  const params = new URLSearchParams();
  params.set('year', String(year));
  if (workId) params.set('work_id', String(workId));
  if (name)   params.set('name', String(name));
  const res = await apiRequest(`/api/scores/annual?${params}`);
  return (
    res?.data || {
      basicAvg: 0,
      contributionAvg: 0,
      credit: 0,
      discipline: 0,
      total: 0,
    }
  );
}

// 员工自取本人当月（或全年）基础积分记录，仅用于「基础积分评价查看」只读页
//   - 不传 month → 当年所有月份（数组），供月历展示
//   - 传 month   → 单月记录；无记录返回 null
// 服务端已强制覆盖为 req.user 身份，客户端无需再传 workId / name
export async function getMyRating({ year, month } = {}) {
  if (USE_MOCK) return month ? null : [];
  const params = new URLSearchParams();
  params.set('year', String(year));
  if (month !== undefined && month !== null) params.set('month', String(month));
  const res = await apiRequest(`/api/ratings/me?${params}`);
  return res?.data ?? (month ? null : []);
}

export function getApp() {
  throw new Error('getApp 已废弃：请使用 cloudbase.js 中的 apiRequest');
}
