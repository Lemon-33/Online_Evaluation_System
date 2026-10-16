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
//   reviewComment 整体扣分原因（写入 rating.reviewComment 列；当前页面已取消该输入，固定传空串）
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

// 本人某年度的年度红线扣分记录（只读查看自己的卷子）
//   后端按 token 里的 work_id 强制取自己那一条，不存在时返回 null
export async function getMyDiscipline({ year } = {}) {
  if (USE_MOCK) return null;
  const res = await apiRequest(`/api/disciplines/mine?year=${String(year)}`);
  return res?.data || null;
}

// 个人偏好：读取本人侧边栏模块排序（返回 key 数组；无记录 = 用默认顺序）
export async function getMyMenuOrder() {
  if (USE_MOCK) return [];
  const res = await apiRequest('/api/settings/menu-order');
  const v = res?.data?.order;
  return Array.isArray(v) ? v : [];
}

// 个人偏好：保存本人侧边栏模块排序（order = 菜单 key 数组）
export async function saveMyMenuOrder(order = []) {
  if (USE_MOCK) return order;
  const res = await apiRequest('/api/settings/menu-order', {
    method: 'PUT',
    body: JSON.stringify({ order }),
  });
  const v = res?.data?.order;
  return Array.isArray(v) ? v : order;
}

// 年度红线扣分列表（分管领导）
//   year    必填（一年一人一条）
//   status  可选：pending / reviewed
//   keyword 可选：按姓名模糊搜索
//   数据范围由后端强制限定为本支部（分管领导自己的 branch）
export async function listDisciplines({ year, status, keyword } = {}) {
  if (USE_MOCK) return [];
  const params = { year: String(year) };
  if (status) params.status = status;
  if (keyword) params.keyword = keyword;
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/disciplines?${qs}`);
  return res?.data || [];
}

// 分管领导提交某条年度红线扣分（问卷形式）
//   scores       每题「有无 + 事由」答案 + 快照 + 扣分合计（写入 discipline.scores）
//   reviewScore  扣分合计（负数）
//   整体扣分原因不再采集 → 后端固定写空串
export async function submitDisciplineReview(id, { scores, reviewScore } = {}) {
  if (USE_MOCK) return null;
  await apiRequest(`/api/disciplines/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ scores, reviewScore }),
  });
  return { id, scores, reviewScore, reviewStatus: 'reviewed' };
}

// 年度专项加分审核列表（支部书记 / 分管领导）
//   year 必传（年度口径，没有月份）；status 可选 pending / reviewed；keyword 按姓名模糊搜索
//   后端不做惰性生成：当年没人申报就是空数组
export async function listCredits({ year, status, keyword } = {}) {
  if (USE_MOCK) return [];
  const params = { year: String(year) };
  if (status) params.status = status;
  if (keyword) params.keyword = keyword;
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest(`/api/credits?${qs}`);
  return res?.data || [];
}

// 本人某年度的专项加分申报记录（没有申报过 → null；后端不做惰性生成）
export async function getMyCredit({ year } = {}) {
  if (USE_MOCK) return null;
  const res = await apiRequest(`/api/credits/mine?year=${String(year)}`);
  return res?.data || null;
}

// 提交 / 覆盖本人的年度专项加分申报（后端按 work_id + year upsert）
//   scores    { answers, snapshot }
//   selfTotal 自报合计（按题面规则算出）
export async function submitCreditApply({ year, scores, selfTotal } = {}) {
  if (USE_MOCK) return null;
  const res = await apiRequest('/api/credits/mine', {
    method: 'PUT',
    body: JSON.stringify({ year, scores, selfTotal }),
  });
  // 已审核 → 不允许再改
  if (res?.code === 'ALREADY_REVIEWED')
    throw new Error(res.message || '该年度专项加分已审核，不能修改');
  return res?.data || null;
}

// 提交某条年度专项加分的审核结果
//   scores        审核版答案 { answers, snapshot }（审核人在卷子上改过的内容）
//   reviewScore   按审核版答案自动算出的核定加分（页面不再手填数字）
//   reviewComment 审核意见
export async function submitCreditReview(id, { scores, reviewScore, reviewComment } = {}) {
  if (USE_MOCK) return null;
  await apiRequest(`/api/credits/${id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ scores, reviewScore, reviewComment }),
  });
  return { id, reviewScore, reviewComment, reviewStatus: 'reviewed' };
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

// 本人年度总排名（全单位一起排，实时算）：只回本人名次 + 参与人数 + 本人分数
//   ranked=false → 当年缺基础积分 / 履职贡献记录，不参与排名
export async function getMyAnnualRank({ year } = {}) {
  if (USE_MOCK) return null;
  const res = await apiRequest(`/api/scores/annual/rank?year=${String(year)}`);
  return res?.data || null;
}

// 积分汇总（组织委员 / 支部书记 / 分管领导）：某个月的基础积分 / 履职贡献 / 总分
//   branch  'all'（全体成员）| 'first' / 'second'（指定支部）| 不传（本人所在支部）
//           组织委员只能看自己支部 —— 传了也由后端强制覆盖
//   后端已按总分降序排好；无记录 / 未审核的模块按 0 分返回，但仍出现在列表里
//   两个「具体事宜」字段后端返回数组：
//     basicMatters        [{ key, label, count, unit, reason }]  数量不为 0 的扣分题
//     contributionMatters 同上（数量不为 0 的填空题，加分/扣分都列）
//     contributionComment 审核理由，前端作为履职贡献具体事宜的最后一点
//   每行还带该成员所属支部 row.branch（全体模式下用于列表区分）
export async function getBranchMonthlySummary({ year, month, branch } = {}) {
  if (USE_MOCK) return { year, month, branch: '', rows: [] };
  const params = new URLSearchParams();
  params.set('year', String(year));
  params.set('month', String(month));
  if (branch) params.set('branch', branch);
  const res = await apiRequest(`/api/summary/monthly?${params}`);
  return res?.data || { year, month, branch: '', rows: [] };
}

// 支部年度积分汇总（组织委员 / 支部书记 / 分管领导）
//   year 必传；branch 不传 = 本人支部，'all' = 全体成员
//   口径：基础积分 / 履职贡献 = 当年有记录月份的平均分；
//         年度专项加分 = credit.reviewScore；年度红线扣分 = discipline.reviewScore
export async function getBranchAnnualSummary({ year, branch } = {}) {
  if (USE_MOCK) return { year, branch: '', rows: [] };
  const params = new URLSearchParams();
  params.set('year', String(year));
  if (branch) params.set('branch', branch);
  const res = await apiRequest(`/api/summary/annual?${params}`);
  return res?.data || { year, branch: '', rows: [] };
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

// ============================================================
// 个人专属问卷（form_override）—— 后端 form_override 表
// ------------------------------------------------------------
// 用途：给某个员工单独定制一份「履职贡献」问卷（改题干 / 改选项 / 改分值 / 增删题 / 调序）。
// UI 入口：/backdoor →「个人问卷维护」Tab（仅系统管理员；组件见 components/FormOverridePanel.jsx）
// 生效优先级见 constants.resolveFormDef：
//   已审核 snapshot  >  本接口的 formDef  >  forms-data.mjs 的 USER_FORM_OVERRIDES  >  基础模板
// 注意：这类接口失败**绝不能**阻断自评 / 审核主流程，所以读取一律吞错回落。
// ============================================================

// 读取某人的个人卷子；未定制 / 无权限 / 网络异常 → null（调用方回落基础模板）
export async function getFormOverride(workId) {
  if (!workId) return null;
  if (USE_MOCK) return null;
  try {
    const res = await apiRequest(
      `/api/form-overrides/${encodeURIComponent(workId)}`
    );
    return res?.data || null;
  } catch (e) {
    // 401 已由 apiRequest 内部跳登录；其余（无权限 / 网络抖动）静默回落
    console.warn('[form-override] 拉取个人卷子失败，回落基础模板：', e?.message);
    return null;
  }
}

// 可定制卷子的员工名单（维护页选人用）→ { list: [...], customized: [work_id] }
export async function listFormOverrideMembers() {
  if (USE_MOCK) return { list: [], customized: [] };
  const res = await apiRequest('/api/form-overrides/members');
  return res?.data || { list: [], customized: [] };
}

// 保存（新建 / 覆盖）个人卷子
export async function saveFormOverride(workId, { position, formDef, note }) {
  const res = await apiRequest(
    `/api/form-overrides/${encodeURIComponent(workId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ position, formDef, note }),
    }
  );
  if (res?.code && res.code !== 'OK')
    throw new Error(res.message || '保存失败');
  return res?.data || null;
}

// 删除个人卷子（恢复默认：回到岗位基础模板）
export async function deleteFormOverride(workId) {
  const res = await apiRequest(
    `/api/form-overrides/${encodeURIComponent(workId)}`,
    { method: 'DELETE' }
  );
  if (res?.code && res.code !== 'OK')
    throw new Error(res.message || '恢复默认失败');
  return res?.data || null;
}

export function getApp() {
  throw new Error('getApp 已废弃：请使用 cloudbase.js 中的 apiRequest');
}
