// CloudBase 初始化与数据访问层
// 通过环境变量 VITE_USE_MOCK 切换真实接入 / 本地 mock，方便离线调试

import cloudbase from '@cloudbase/js-sdk';
import dayjs from 'dayjs';
import { calcTotal, calcGrade, matchBranch, findBranchLabel } from './constants';

const ENV_ID = import.meta.env.VITE_TCB_ENV;
const USE_MOCK = String(import.meta.env.VITE_USE_MOCK).toLowerCase() === 'true';
const COLLECTION = 'evaluations';

let app = null;
let _db = null;

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

// ---------- 初始化 ----------
export async function initCloudBase() {
  if (USE_MOCK) return { mock: true };
  if (!ENV_ID) {
    console.warn('[CloudBase] 未配置 VITE_TCB_ENV，将使用 Mock 模式');
    return { mock: true };
  }
  if (!app) {
    app = cloudbase.init({ env: ENV_ID });
    // 匿名登录：调用云函数要走 CloudBase 平台鉴权，必须持有登录态。
    // 本系统的账号体系在自建的 user_table 里（不用云开发身份），所以只需要
    // 一个匿名登录态来通过平台鉴权。
    // ⚠️ 本项目用的是 @cloudbase/js-sdk 1.x，匿名登录只有这一种写法；
    //    v2 的 auth().signInAnonymously() 在 1.x 中不存在，调用会抛 TypeError
    //    并被 catch 吞掉，表现为「后续 callFunction 报鉴权失败」。
    try {
      const auth = app.auth({ persistence: 'local' });
      if (!auth.hasLoginState()) {
        await auth.anonymousAuthProvider().signIn();
      }
    } catch (e) {
      console.error('[CloudBase] 匿名登录失败：', e);
      console.error('[CloudBase] 请到控制台 → 身份认证/登录授权 → 开启「匿名登录」后刷新页面');
    }
    _db = app.database();
  }
  return { mock: false };
}

function ensureDb() {
  if (!_db) throw new Error('CloudBase 尚未初始化');
  return _db;
}

// 供其他数据层（如 userService）复用同一个 CloudBase 实例
export function getApp() {
  if (!app) throw new Error('CloudBase 尚未初始化');
  return app;
}

// ---------- 评价 CRUD ----------

// 党员提交 / 更新自评
export async function submitSelfEvaluation(payload) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const scores = payload.scores || {};
  const total = calcTotal(scores);
  const record = {
    name: payload.name,
    // 所属党支部：统一存 value（'first' / 'second'），便于按支部隔离审核范围
    partyBranch: payload.branch || payload.partyBranch,
    year: payload.year,
    // 员工档案（注册时填写，随自评快照）
    position: payload.position || '',
    positionType: payload.positionType || '',
    selfContent: payload.selfContent,
    scores,
    selfTotal: total,
    selfGrade: calcGrade(total),
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
      (x) => x.name === payload.name && x.year === payload.year
    );
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

  const db = ensureDb();
  const { data } = await db
    .collection(COLLECTION)
    .where({ name: payload.name, year: payload.year })
    .get();
  if (Array.isArray(data) && data.length > 0) {
    const id = data[0]._id;
    await db.collection(COLLECTION).doc(id).update({ ...record, updatedAt: now });
    return { ...record, _id: id };
  }
  const res = await db.collection(COLLECTION).add(record);
  return { ...record, _id: res.id };
}

// 查询某党员指定年度的自评
export async function getMyEvaluation(name, year) {
  if (USE_MOCK) {
    const list = readMock();
    return list.find((x) => x.name === name && x.year === year) || null;
  }
  const db = ensureDb();
  const { data } = await db
    .collection(COLLECTION)
    .where({ name, year })
    .limit(1)
    .get();
  return data && data[0] ? { ...data[0], id: data[0]._id } : null;
}

// 评价列表（带筛选）
// branch: 传入党支部 value（'first' / 'second'）时，只返回该支部的员工评价
//         —— 管理员据此只看到自己负责审核的员工
export async function listEvaluations({ year, status, keyword, branch } = {}) {
  if (USE_MOCK) {
    let list = readMock();
    if (year) list = list.filter((x) => x.year === year);
    if (status) list = list.filter((x) => x.reviewStatus === status);
    if (keyword) list = list.filter((x) => x.name?.includes(keyword));
    if (branch) list = list.filter((x) => matchBranch(x.partyBranch, branch));
    return list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }

  const db = ensureDb();
  const _ = db.command;
  const where = {};
  if (year) where.year = year;
  if (status) where.reviewStatus = status;
  if (keyword) where.name = _.regex({ regex: keyword, options: 'i' });
  if (branch) {
    // 兼容历史数据：同时匹配 value('first') 与中文('第一党支部')
    where.partyBranch = _.in([branch, findBranchLabel(branch)]);
  }
  const { data } = await db
    .collection(COLLECTION)
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();
  return (data || []).map((d) => ({ ...d, id: d._id }));
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
  const db = ensureDb();
  await db.collection(COLLECTION).doc(id).update(patch);
  return { id, ...patch };
}

// 删除
export async function deleteEvaluation(id) {
  if (USE_MOCK) {
    const list = readMock().filter((x) => x.id !== id);
    writeMock(list);
    return true;
  }
  const db = ensureDb();
  await db.collection(COLLECTION).doc(id).remove();
  return true;
}

// 提供给前端判断当前是否 mock
export const isMockMode = () => USE_MOCK || !ENV_ID;