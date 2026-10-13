import express from 'express';
import cors from 'cors';
import compression from 'compression';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { lookupWorkId } from './admin-whitelist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'party.db');

const app = express();
app.use(cors());
app.use(compression()); // 响应 gzip 压缩：首屏 1.4MB → 约 460KB
app.use(express.json({ limit: '2mb' }));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000'); // 并发写入时排队等待，而不是直接报 SQLITE_BUSY
db.exec(`
  CREATE TABLE IF NOT EXISTS user_table (
    user_id TEXT PRIMARY KEY,
    pw TEXT NOT NULL,
    name TEXT NOT NULL,
    work_id TEXT NOT NULL,
    admin INTEGER DEFAULT 0,
    -- admin_type: 0=分管领导, 1=组织委员, 默认 0（与 admin=0 配套才表示普通党员）
    admin_type INTEGER DEFAULT 0,
    type TEXT,
    job TEXT,
    branch TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_table_work_id ON user_table(work_id) WHERE work_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS evaluation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    -- 同一人同一年同一月只保留一条自评：重复提交走"覆盖更新"，不产生新行
    UNIQUE(name, year, month)
  );
`);

// 老库升级：补加 admin_type 列（SQLite 没有 IF NOT EXISTS for columns，
// 靠 try/catch 兜底：列已存在会抛错，吞掉即可）
try {
  db.exec('ALTER TABLE user_table ADD COLUMN admin_type INTEGER DEFAULT 0');
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
  const { user_id, pw, name, work_id, role, type, job, branch } = req.body || {};
  if (!user_id || !pw || !name || !work_id || !role || !branch)
    return res.json({ code: 'BAD_INPUT', message: '缺少必填字段（user_id/pw/name/work_id/role/branch）' });

  // 工作证编号必须在白名单内（不区分大小写）
  const wl = lookupWorkId(work_id);
  if (!wl) {
    return res.json({ code: 'WORK_ID_NOT_IN_LIST', message: '工作证编号异常，请重新输入' });
  }

  // 角色一致性校验：用户选的 role 必须与 work_id 在白名单里的身份匹配
  //   role='admin'    → work_id 必须在白名单前 4（管理员编号）
  //   role='employee' → work_id 必须在白名单其他（普通党员编号）
  // 这样防止：
  //   ① 有人用普通员工编号冒充管理员注册
  //   ② 有人用管理员编号注册成员工（管理员编号是稀缺资源，应该只给管理员用）
  const wantsAdmin = role === 'admin';
  if (wantsAdmin && wl.kind !== 'admin') {
    return res.json({ code: 'WORK_ID_NOT_ADMIN', message: '该工作证编号不是管理员编号，无法注册为管理员' });
  }
  if (!wantsAdmin && wl.kind === 'admin') {
    return res.json({ code: 'WORK_ID_IS_ADMIN', message: '该工作证编号属于管理员，请用「管理员」身份注册' });
  }

  if (db.prepare('SELECT 1 FROM user_table WHERE user_id = ?').get(user_id))
    return res.json({ code: 'USER_EXISTS', message: '该工号已被注册' });

  // 工作证编号 work_id 必须全局唯一（NULL 除外）：已存在则提示"当前工号员工已经注册"
  if (db.prepare('SELECT 1 FROM user_table WHERE work_id = ?').get(work_id))
    return res.json({ code: 'DUP_WORK_ID', message: '当前工号员工已经注册' });

  const isAdmin = wantsAdmin ? 1 : 0;
  const adminType = wantsAdmin ? wl.adminType : 0;

  db.prepare(`INSERT INTO user_table (user_id, pw, name, work_id, admin, admin_type, type, job, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      user_id, pw, name, work_id, isAdmin, adminType,
      isAdmin ? null : type || null, // 管理员不写岗位信息
      isAdmin ? null : job || null,
      branch
    );
  res.json({ code: 'OK', user: db.prepare(`SELECT user_id, name, work_id, admin, admin_type, type, job, branch FROM user_table WHERE user_id = ?`).get(user_id) });
});
app.post('/api/login', (req, res) => {
  const { user_id, pw } = req.body || {};
  if (!user_id || !pw) return res.json({ code: 'BAD_INPUT', message: '请输入工号和密码' });
  const user = db.prepare(`SELECT user_id, name, work_id, admin, admin_type, type, job, branch FROM user_table WHERE user_id = ? AND pw = ?`).get(user_id, pw);
  if (!user) return res.json({ code: 'BAD_CREDENTIALS', message: '工号或密码错误' });
  res.json({ code: 'OK', user });
});

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

app.post('/api/evaluations', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.year) return res.json({ code: 'BAD_INPUT', message: '缺少 name/year' });
  const month = Number(b.month) || 1; // 未传月份的旧客户端按 1 月处理
  // 不允许提交未来月份（前端已禁用未来月份，此处兜底防止绕过前端直接调接口）
  const nowD = new Date();
  if (Number(b.year) > nowD.getFullYear() ||
      (Number(b.year) === nowD.getFullYear() && month > nowD.getMonth() + 1))
    return res.json({ code: 'FUTURE_MONTH', message: '提交时间不能晚于当前月份，请修改后重试' });
  const scores = JSON.stringify(b.scores || {});
  const ex = db.prepare('SELECT id, reviewStatus FROM evaluation WHERE name = ? AND year = ? AND month = ?').get(b.name, b.year, month);
  if (ex) {
    // 该月已被管理员审核 → 锁定，不允许覆盖（防止重复提交把审核结果冲掉）
    if (ex.reviewStatus === 'reviewed')
      return res.json({ code: 'ALREADY_REVIEWED', message: `${b.year} 年 ${month} 月的自评已审核完成，不能重复提交覆盖` });
    // 待审核 → 直接覆盖，审核人看到的始终是最后一次提交
    db.prepare(`UPDATE evaluation SET partyBranch=?, position=?, positionType=?, scores=?, selfTotal=?, updatedAt=? WHERE id=?`)
      .run(b.partyBranch || b.branch || null, b.position || '', b.positionType || '', scores, b.selfTotal || 0, now(), ex.id);
    return res.json({ code: 'OK', id: ex.id, overwritten: true });
  }
  const r = db.prepare(`INSERT INTO evaluation (name, partyBranch, year, month, position, positionType, scores, selfTotal, reviewStatus, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(b.name, b.partyBranch || b.branch || null, b.year, month, b.position || '', b.positionType || '', scores, b.selfTotal || 0, now(), now());
  res.json({ code: 'OK', id: r.lastInsertRowid });
});
app.get('/api/evaluations', (req, res) => {
  const { year, month, status, keyword, branch } = req.query;
  let sql = 'SELECT * FROM evaluation WHERE 1=1';
  const args = [];
  if (year)    { sql += ' AND year = ?';         args.push(year); }
  if (month)   { sql += ' AND month = ?';        args.push(month); }
  if (status)  { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?';      args.push('%' + keyword + '%'); }
  if (branch)  { sql += ' AND partyBranch = ?';  args.push(branch); }
  sql += ' ORDER BY createdAt DESC LIMIT 200';
  res.json({ code: 'OK', data: db.prepare(sql).all(...args).map(r => ({ ...r, scores: r.scores ? JSON.parse(r.scores) : {} })) });
});
app.patch('/api/evaluations/:id/review', (req, res) => {
  const { reviewScore, reviewComment, reviewerName } = req.body || {};
  const r = db.prepare(`UPDATE evaluation SET reviewScore=?, reviewComment=?, reviewerName=?, reviewedAt=?, reviewStatus='reviewed', updatedAt=? WHERE id=?`)
    .run(reviewScore, reviewComment || '', reviewerName || '', now(), now(), req.params.id);
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});
app.delete('/api/evaluations/:id', (req, res) => {
  db.prepare('DELETE FROM evaluation WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});

// ---------- 托管前端静态文件（dist 目录与 index.js 同级） ----------
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST));
// SPA 路由兜底：非 /api 的请求一律返回 index.html（刷新页面不会 404）
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`[pingjia] listening on http://0.0.0.0:${PORT}`));
