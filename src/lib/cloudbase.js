// CloudBase 初始化与数据访问层（@cloudbase/js-sdk v2）
// 通过环境变量 VITE_USE_MOCK 切换真实接入 / 本地 mock，方便离线调试
//
// 鉴权说明（v2）：
//   本系统的账号/权限逻辑完全在自建的 user_table（云函数里）维护。
//   前端访问 CloudBase 平台服务（callFunction、database）需要：
//     1. init 时传 accessKey（Publishable Key，控制台「ApiKey 管理」获取）
//     2. 调用 auth.signInAnonymously() 拿到匿名登录态
//   匿名登录与用户注册/登录无关：它只是“调用云函数的门票”，
//   真实账号仍由 userService 云函数写入 user_table 来管理。
//
// ⚠️ 升级到 v2 后必须做三件事：
//   1. npm install @cloudbase/js-sdk@latest
//   2. .env.local 里配置 VITE_TCB_ACCESS_KEY（Publishable Key）
//   3. 控制台 → 身份认证 → 登录方式 → 开启「匿名登录」（你已经开了）

import cloudbase from '@cloudbase/js-sdk';
import dayjs from 'dayjs';
import { calcTotal, calcGrade, matchBranch, findBranchLabel } from './constants';

const ENV_ID = import.meta.env.VITE_TCB_ENV;
const ACCESS_KEY = import.meta.env.VITE_TCB_ACCESS_KEY;
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
  if (!ENV_ID || !ACCESS_KEY) {
    console.error(
      '[CloudBase] 环境变量不完整：',
      !ENV_ID ? '缺少 VITE_TCB_ENV ' : '',
      !ACCESS_KEY ? '缺少 VITE_TCB_ACCESS_KEY（Publishable Key）' : ''
    );
    return { mock: true };
  }
  if (!app) {
    // v2 初始化：必须带 accessKey
    app = cloudbase.init({
      env: ENV_ID,
      accessKey: ACCESS_KEY,
    });
    // v2 匿名登录：拿到平台登录态，callFunction / database 才能通过鉴权
    try {
      const auth = app.auth();
      await auth.signInAnonymously();
    } catch (e) {
      console.error('[CloudBase] 匿名登录失败：', e);
      console.error(
        '[CloudBase] 请确认：① 已安装 @cloudbase/js-sdk v2（v1 没有 signInAnonymously）；' +
          '② 控制台「身份认证 → 登录方式 → 匿名登录」已开启'
      );
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
export const isMockMode = () => USE_MOCK || !ENV_ID || !ACCESS_KEY;
