import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  lookupWorkId,
  ADMIN_TYPE_LEADER,
  ADMIN_TYPE_ORGANIZER,
  ADMIN_TYPE_SECRETARY,
  ADMIN_TYPE_EMPLOYEE,
  ADMIN_TYPE_DIRECTOR,
} from './admin-whitelist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'party.db');

// 履职贡献自评的开放起点：2026 年 10 月。
//   早于它的月份（2026-09 及以前）已封档 → POST /api/evaluations 直接拒绝。
//   与前端 src/lib/constants.js 的 EVAL_OPEN_FROM 保持一致（两边改的时候一起改）
const EVAL_OPEN_FROM = { year: 2026, month: 10 };

// ============================================================
// 读取 server/.env（若存在）—— 只为「后门口令」这类密钥省去改 PM2/systemd 的麻烦
// ------------------------------------------------------------
// 规则：
//   ① 已存在的**真实环境变量优先**，本文件不覆盖（.env 只是兜底）
//   ② 只解析 KEY=VALUE，支持 # 注释、两侧空白、成对的引号
//   ③ 文件不存在 / 解析不出东西都无所谓，后面会用明确报错拦住启动
// 注意：.env 里放的是密钥，已在 .gitignore 中忽略，不要提交
// ============================================================
(function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2) {
      const q = val[0];
      if ((q === '"' || q === "'") && val.endsWith(q)) val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
})();

// ============================================================
// 口令哈希（scrypt —— Node 内置 crypto，零新增依赖）
// ------------------------------------------------------------
// 存储格式（单行文本，既能进 SQLite 的 user_table.pw，也能写进 .env）：
//     scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
// 为什么用 scrypt 而不是 bcrypt：
//   ① Node 20 自带 crypto.scryptSync，生产机**不需要再 npm install 任何东西**
//      （这台服务器上 better-sqlite3 是原生模块，能不加依赖就不加）
//   ② 每个口令一条 16 字节随机盐 → 相同口令在库里也是不同的串，彩虹表 / 批量比对失效
//   ③ 比对一律走 crypto.timingSafeEqual，避免按字节提前返回带来的计时侧信道
// 参数：N=16384 / r=8 / p=1 → 单次哈希约 16MB 内存、几十毫秒，登录这种低频操作完全可接受。
// ============================================================
const PWD_HASH_PREFIX = 'scrypt';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

// 明文 → 哈希串
function hashPassword(plain) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = crypto.scryptSync(String(plain ?? ''), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    PWD_HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

// 判断一个值是不是我们生成的哈希串（用来识别"没被哈希化的历史明文"）
function isPasswordHash(value) {
  const parts = String(value ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== PWD_HASH_PREFIX) return false;
  const [, , , , salt, hash] = parts;
  return (
    /^[A-Za-z0-9+/=]+$/.test(salt) &&
    salt.length >= 16 &&
    /^[A-Za-z0-9+/=]+$/.test(hash) &&
    hash.length >= 32
  );
}

// 定长比较（长度不同也走一次比较，不用长度差提前返回）
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// 口令校验：stored 是哈希 → scrypt 比对；stored 是明文（迁移残留）→ 明文比较兜底。
//   明文兜底只为"别把老用户锁在门外"，日志会告警，且登录成功后由调用方就地哈希化。
function verifyPassword(plain, stored) {
  const s = String(stored ?? '');
  if (!s) return false;
  if (!isPasswordHash(s)) return timingSafeEqualStr(plain, s);

  const [, n, r, p, saltB64, hashB64] = s.split('$');
  try {
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(plain ?? ''), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    console.error('[pingjia] 口令哈希解析失败：', e.message);
    return false;
  }
}

const app = express();

// 安全响应头（关掉 CSP：内部工具用了 inline style，避免误伤；其它 X-Content-Type-Options /
//   X-Frame-Options / Referrer-Policy 等走 helmet 默认即可）
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS 白名单：默认**不开放任何跨源**（fail-closed），避免被任何站点调用。
//   真要允许跨源（比如另一台机器上的前端调这台 API），在 server/.env 里：
//     ALLOWED_ORIGINS=https://your-frontend.example.com
//   多个用英文逗号分隔。鉴权走 Authorization 头 + localStorage，不用 cookie，所以不开 credentials。
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
  })
);
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
//   ④ 角色分级在每个业务接口内做（支部书记限本支部 / 党总支书记全支部等）
// ============================================================
const SESSION_TTL_DAYS = 7; // 会话有效期（天）

// 公开接口白名单（method + 挂载点内相对路径，注意不含 /api 前缀）
const PUBLIC_ROUTES = new Set([
  'GET /ping',          // 健康检查
  'GET /gateway',       // 数据库连通性检查
  'POST /login',        // 登录（本来就是换 token 的入口）
  'POST /register',     // 注册（白名单 work_id 校验在接口内做）
  'POST /backdoor/login', // 后门登录：口令取自 BACKDOOR_PASSWORD → admin_type=9 系统管理员
  // 忘记用户名 / 密码：用户此时尚未登录，必须公开。
  // ⚠️ 这两个是**全站唯一的、用「猜得到的信息」就能改账号密码**的入口，
  //    风险与已做的下限保护见其实现处的说明（搜「忘记用户名 / 密码」）
  'POST /recover/lookup',
  'POST /recover/reset',
]);

// 「系统管理员」身份：用于隐藏的 /backdoor 维护工具入口
//   - 不在白名单里（admin-whitelist.mjs 不动）
//   - 不在 BASIC_RATING_TYPES / SELF_EVAL_TYPES 里（不会出现在普通业务接口）
//   - 登录后只能进 /api/backdoor/* 端点（每个端点都校验 admin_type === 9）
const ADMIN_TYPE_SYSTEM = 9;
const BACKDOOR_USER_ID = '__backdoor__';
const BACKDOOR_WORK_ID = 'superadmin';
// 判断某个工号是不是系统管理员那条记录（大小写不敏感）
//   工号在库里可能以任意大小写存在，保护性判断必须与 NOCASE 口径一致，
//   否则 'SuperAdmin' 这类变体就能绕过「不许动系统管理员」的拦截
const isBackdoorWorkId = (v) => String(v ?? '').trim().toLowerCase() === BACKDOOR_WORK_ID;
// 后门口令的**哈希**：只从环境变量 / server/.env 读取，源码里不留任何兜底值。
//   以前写成 `process.env.BACKDOOR_PASSWORD || '内建口令'`：那个兜底值早已随仓库泄露，
//   而且当时后端根本没有解析 .env 的能力 —— 等于线上一直在用这个写死的口令。
//   现在改成「.env 里只放哈希」：即便 .env 被看到 / 被误提交，也**还原不出明文口令**，
//   里面的哈希又与 user_table 里系统管理员那行的 pw 同名同值，两边天然一致。
//   哈希用 node server/hash-password.mjs <口令> 生成。
// 兼容：若只配了旧的明文 BACKDOOR_PASSWORD，这里会就地哈希后在内存中使用（不落库成明文），
//       并打印告警催你换成 BACKDOOR_PASSWORD_HASH，避免线上服务因为改名而直接起不来。
const BACKDOOR_PASSWORD_HASH = (() => {
  const fromEnvHash = String(process.env.BACKDOOR_PASSWORD_HASH || '').trim();
  if (fromEnvHash) {
    if (!isPasswordHash(fromEnvHash)) {
      console.error(
        [
          '',
          '【启动失败】BACKDOOR_PASSWORD_HASH 不是合法的口令哈希。',
          '',
          '  这个变量里必须放哈希串（形如 scrypt$16384$8$1$<salt>$<hash>），不能放明文口令。',
          '  生成方式（在 server/ 目录下）：',
          '      node hash-password.mjs                # 随机生成一个新口令，并打印哈希',
          '      node hash-password.mjs 你的口令        # 把某个已有口令转成哈希',
          '',
        ].join('\n')
      );
      process.exit(1);
    }
    return fromEnvHash;
  }

  const legacyPlain = String(process.env.BACKDOOR_PASSWORD || '');
  if (legacyPlain) {
    if (legacyPlain.length < 12)
      console.warn('[pingjia] ⚠️ 后门口令不足 12 位，建议换成更长的随机口令');
    console.warn(
      '[pingjia] ⚠️ 检测到明文 BACKDOOR_PASSWORD（已不再推荐）：' +
        '本次启动已在内存中按哈希方式使用，库内也只落哈希。' +
        '请尽快改成 BACKDOOR_PASSWORD_HASH=<哈希> 并删掉 .env 里的明文那一行。'
    );
    return hashPassword(legacyPlain);
  }

  console.error(
    [
      '',
      '【启动失败】未设置后门口令，服务已拒绝启动。',
      '',
      '  设置方式（任选其一，推荐 ① ）：',
      '    ① server/.env 里放**哈希**（不是明文）：',
      '         cd server && node hash-password.mjs        # 生成随机口令 + 对应哈希',
      '         然后把输出的 BACKDOOR_PASSWORD_HASH=... 粘进 server/.env',
      '    ② 在操作系统环境变量里设置同名变量：',
      '         Linux / systemd：Environment=BACKDOOR_PASSWORD_HASH=scrypt$...',
      '         PM2：            pm2 start server.js --env BACKDOOR_PASSWORD_HASH=scrypt$...',
      '         Windows：        setx BACKDOOR_PASSWORD_HASH "scrypt$..."（需重开终端）',
      '',
      '  ⚠️ 明文口令请自己留好（密码管理器 / 保险柜）：哈希是单向的，忘了只能重新生成一个。',
      '  口令一改，库里的系统管理员口令会在服务启动时自动同步。',
      '',
    ].join('\n')
  );
  process.exit(1);
})();

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
//   0 = 支部书记   1 = 组织委员   2 = 党总支书记   3 = 普通党员   4 = 分管领导
const isLeader    = (u) => !!u && u.admin_type === ADMIN_TYPE_LEADER;    // 支部书记
const isOrganizer = (u) => !!u && u.admin_type === ADMIN_TYPE_ORGANIZER; // 组织委员
const isSecretary = (u) => !!u && u.admin_type === ADMIN_TYPE_SECRETARY; // 党总支书记
const isEmployee  = (u) => !!u && u.admin_type === ADMIN_TYPE_EMPLOYEE;  // 普通党员
const isDirector  = (u) => !!u && u.admin_type === ADMIN_TYPE_DIRECTOR;  // 分管领导

// 可提交「履职贡献自评」的 admin_type：普通党员(3) + 组织委员(1)
// （支部书记 / 分管领导只审核不自评；党总支书记只审核，均不自评）
const SELF_EVAL_TYPES = [ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_EMPLOYEE];
const canSelfEval = (u) => !!u && SELF_EVAL_TYPES.includes(u.admin_type);

// 基础积分「被评对象」的 admin_type 集合：现在只含 1/3，写成数组方便以后加 0/2
const BASIC_RATING_TYPES = [ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_EMPLOYEE];

// 我在 review_assignment 里被指派要审的人（work_id 列表）
//   COLLATE NOCASE：工号大小写口径与注册（normWorkId）一致，
//   否则「关系里存小写 + 账号是 uppercase」会匹配不上 → 审核列表为空
const reviewTargetsOf = (workId) =>
  workId
    ? db
        .prepare(
          'SELECT target_work_id FROM review_assignment WHERE reviewer_work_id COLLATE NOCASE = ?'
        )
        .all(String(workId))
        .map((r) => r.target_work_id)
    : [];

// 「期」= year*12 + month —— 把年月折成一个整数，方便比较先后
const periodOf = (year, month) => Number(year || 0) * 12 + (Number(month) || 1);

// 审核关系的**生效起始期** = 这条 review_assignment 建立的年月（取自 created_at）
//   业务口径：审核关系**只对建立当月及未来生效**。
//   今天给某人新加一条审核关系，被审核人**历史月份**的自评不该突然出现在他的审核界面里。
//   created_at 形如 '2026-10-19 15:04:05'（列定义 datetime('now','localtime')）
const assignmentFromPeriod = (createdAt) => {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(createdAt || ''));
  return m ? periodOf(m[1], m[2]) : 0; // 取不到（异常 / 空）→ 0 = 不设限
};

// 我名下每条审核关系的生效起始期 → Map<target_work_id(小写), fromPeriod>
const reviewTargetFromPeriodsOf = (workId) => {
  const map = new Map();
  if (!workId) return map;
  for (const r of db
    .prepare(
      'SELECT target_work_id, created_at FROM review_assignment WHERE reviewer_work_id COLLATE NOCASE = ?'
    )
    .all(String(workId))) {
    if (!r.target_work_id) continue;
    map.set(String(r.target_work_id).toLowerCase(), assignmentFromPeriod(r.created_at));
  }
  return map;
};

// 这条记录是不是**我本人**审过的：`evaluation.reviewers` 里有我的工号。
//   与 `review_assignment.created_at` 是两回事 —— 前者是「这条卷子谁审过」，
//   后者是「我什么时候成为他的审核人」。
const reviewedByMe = (me, rec) => {
  const mine = String(me?.work_id || '').toLowerCase();
  if (!mine) return false;
  return parseJsonArray(rec?.reviewers).some(
    (x) => String(x?.workId || '').toLowerCase() === mine
  );
};

// 单条记录的判定：该记录是否落在「审核关系生效之后」
//   历史月份（早于关系建立月份）对该审核人**不可见 / 不可审**
const withinAssignmentPeriod = (me, rec) => {
  if (!rec?.work_id) return false;
  const row = db
    .prepare(
      'SELECT created_at FROM review_assignment WHERE reviewer_work_id COLLATE NOCASE = ? AND target_work_id COLLATE NOCASE = ?'
    )
    .get(String(me?.work_id || ''), String(rec.work_id));
  if (periodOf(rec.year, rec.month) >= assignmentFromPeriod(row?.created_at)) return true;
  // 例外：**我本人审过**的历史记录始终可见 / 可审 ——
  //   管理员误删审核关系再补回来时（新行 created_at = 当时），不该丢掉我已审过的记录
  return reviewedByMe(me, rec);
};

// 查看单条 evaluation：本人记录 / 我在 review_assignment 里被指派的审核对象
//   注：党总支书记**不再**有「全体可见」的特判 —— 它的审核范围与所有人一样，
//   完全由 review_assignment 决定。刚注册时该表为空（ scopes 为空），
//   需要由系统管理员在「审核关系维护」里指派后才看得到。
const canViewEvaluation = (me, rec) => {
  if (!me || !rec) return false;
  if (canSelfEval(me) && me.work_id && rec.work_id === me.work_id) return true;
  if (!rec.work_id) return false;
  if (!reviewTargetsOf(me.work_id).includes(rec.work_id)) return false;
  // 审核关系只对建立当月及未来生效：建立之前的历史月份即使拿到 id 也看不到
  return withinAssignmentPeriod(me, rec);
};

// 审核 / 删除单条 evaluation：仅限我的审核对象（本人不能审自己）
const canReviewEvaluation = (me, rec) => {
  if (!me || !rec) return false;
  if (!rec.work_id) return false;
  if (!reviewTargetsOf(me.work_id).includes(rec.work_id)) return false;
  return withinAssignmentPeriod(me, rec);
};

// 「我的审核状态」—— 派生字段，不落库
// ---------------------------------------------------------------------------
// 为什么需要它：一个被审核人可以配**多个**审核人，而 evaluation 一人一月只有一行、
//   只有一个**记录级**的 reviewStatus。甲审完 → reviewStatus='reviewed' →
//   这条记录就从乙的「待审核」列表里消失了，乙根本不知道自己还没审。
//
// 所以审核人视图一律改用 myReviewStatus（由 reviewers 列派生）：
//   'reviewed' = reviewers 里有我的工号（我审过）
//   'pending'  = 没有（我没审过，不管别人审没审）
//
// 记录级 reviewStatus **语义保持不变**，继续服务员工端「自评已锁定」和积分汇总取审核分。
// 不是我的审核对象时（例如员工查自己的自评）返回 null —— 对员工这个字段没有意义。
// 是否「历史月份」：早于当前年月
const isPastMonth = (year, month) => {
  const y = Number(year) || 0;
  const m = Number(month) || 1;
  const d = new Date();
  const cy = d.getFullYear();
  const cm = d.getMonth() + 1;
  return y < cy || (y === cy && m < cm);
};

const myReviewStatusOf = (me, rec, myTargets) => {
  if (!me?.work_id || !rec?.work_id) return null;
  if (!myTargets || !myTargets.has(String(rec.work_id).toLowerCase())) return null;
  const list = parseJsonArray(rec.reviewers);
  // 历史月份 + 没有 reviewers（加列之前就已审完的）：**不重新开启**，
  //   沿用记录级 reviewStatus —— 审核关系与本次改动只对**当月和未来**生效，历史月份保持原样
  if (!list.length && isPastMonth(rec.year, rec.month))
    return rec.reviewStatus === 'reviewed' ? 'reviewed' : 'pending';
  // 当月及未来：reviewers 为空 = 还没人审过（或老数据）→ 一律「待审核」，
  //   让每位审核人都过一遍。反正现行模式就是后提交者覆盖，重审不会产生脏数据。
  if (!list.length) return 'pending';
  const mine = String(me.work_id).toLowerCase();
  return list.some((x) => String(x?.workId || '').toLowerCase() === mine)
    ? 'reviewed'
    : 'pending';
};

// 我审过，但当前生效的不是我的那版（之后被别的审核人覆盖）
const overriddenByOther = (me, rec) => {
  const list = parseJsonArray(rec?.reviewers);
  if (!list.length || !me?.work_id) return false;
  const mine = String(me.work_id).toLowerCase();
  const idx = list.findIndex((x) => String(x?.workId || '').toLowerCase() === mine);
  return idx >= 0 && idx !== list.length - 1;
};

// 登录 / 注册返回给前端的用户信息补充：各类入口开关
//   hasReviewTargets：是否有「履职积分审核」入口 —— 一律看 review_assignment 里有没有指派，
//     不再按身份特判。党总支书记刚注册时同样为 false，需由系统管理员指派后才为 true
//   canUserAdmin / canReviewAssign / canFormOverride：三个系统维护工具的入口开关
//     默认全员 false；授权存在 permission 表（/backdoor →「权限管理」页维护）
//     前端侧边栏菜单项与路由守卫读这些标记，后端对应接口用同一套判定（canUseTool）
const withUserMeta = (u) =>
  u
    ? {
        ...u,
        hasReviewTargets: reviewTargetsOf(u.work_id).length > 0,
        canUserAdmin: canUseTool(u, 'userAdmin'),
        canReviewAssign: canUseTool(u, 'reviewAssign'),
        canFormOverride: canUseTool(u, 'formOverride'),
      }
    : u;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000'); // 并发写入时排队等待，而不是直接报 SQLITE_BUSY
db.exec(`
  CREATE TABLE IF NOT EXISTS user_table (
    user_id TEXT PRIMARY KEY,
    -- pw 存的是**口令哈希**，不是明文：scrypt$N$r$p$salt$hash（见文件上方的 hashPassword）
    -- 老库里的明文会在服务启动时被就地哈希化，登录方式不变
    pw TEXT NOT NULL,
    name TEXT NOT NULL,
    work_id TEXT NOT NULL,
    -- admin_type: 0=支部书记, 1=组织委员, 2=党总支书记, 3=普通党员（默认）, 4=分管领导
    admin_type INTEGER DEFAULT 3,
    type TEXT,
    job TEXT,
    branch TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  -- 工号唯一：加 COLLATE NOCASE，避免只差大小写的两个工号并存
  -- （permission.work_id 也是 NOCASE，两边口径必须一致，否则授权会串号）
  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_table_work_id ON user_table(work_id COLLATE NOCASE) WHERE work_id IS NOT NULL;
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
  --   - 所有审核人（含党总支书记）都在此登记各自的被审对象（支持后期直接改库维护）
  --   - 党总支书记不再由 admin_type=2 特判成「全体」：其范围同样来自本表，
  --     刚注册时为空，需由系统管理员在「审核关系维护」里指派后才生效
  --   - 基础积分那条线不用此表（由组织委员/党总支书记按角色判定）
  CREATE TABLE IF NOT EXISTS review_assignment (
    reviewer_work_id TEXT NOT NULL,
    target_work_id   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (reviewer_work_id, target_work_id)
  );
  CREATE INDEX IF NOT EXISTS idx_review_target ON review_assignment(target_work_id);
  -- 个人专属卷子：给某个员工单独定制一份「履职贡献」卷子（不限于增/删/改，可整卷重排）
  --   - form_def 存**合并完成的完整 formDef**（{ sections:[{title,items}] }），不是差异补丁
  --   - position 记录生成时该员工的岗位：换岗后 position 对不上 → 本行自动失效（fail-safe）
  --   - 仅影响「未提交 / 未审核」的记录；已审核记录永远按 evaluation.scores.snapshot 渲染
  CREATE TABLE IF NOT EXISTS form_override (
    work_id    TEXT PRIMARY KEY,
    position   TEXT NOT NULL,
    form_def   TEXT NOT NULL,
    note       TEXT,
    updated_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
  -- 系统维护工具「授权表」：谁（work_id）被额外开放了某个工具
  --   - 取代原先写死在 admin-whitelist.mjs 里的 TOOL_GRANTS 常量
  --   - 由系统管理员在 /backdoor →「权限管理」页在线增删；写接口每次实时查本表
  --     → 收回权限后下一个请求就失效，不需要重启
  --   - 系统管理员(admin_type=9) 恒拥有全部工具，不在本表登记
  --   - 「权限管理」本身不可授予：它硬校验 admin_type=9，不进 GRANTABLE_TOOLS
  --   - tool 只存 GRANTABLE_TOOLS 里的 key（写入前已校验，读取时再过滤一次）
  --   - work_id 声明 COLLATE NOCASE：工号大小写不敏感，且主键据此去重
  CREATE TABLE IF NOT EXISTS permission (
    work_id    TEXT NOT NULL COLLATE NOCASE,
    name       TEXT,
    tool       TEXT NOT NULL,
    granted_by TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (work_id, tool)
  );
  -- 「侧边栏排序」个人偏好：用户在「个人信息」页自定义各模块的排列顺序
  --   - orders 存 JSON 数组（菜单 key 的顺序），只存该用户当前可见模块的 key
  --   - 排序结果仅影响本人侧边栏显示，不影响任何业务权限（权限仍由 adminType + permission 表决定）
  --   - 菜单新增模块后，没出现在 orders 里的 key 自动排到末尾（前端 sortMenuItems 兜底）
  CREATE TABLE IF NOT EXISTS user_menu_order (
    work_id    TEXT PRIMARY KEY COLLATE NOCASE,
    orders     TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
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
// evaluation 补加 reviewers 列：**累积**提交过审核的审核人名单（JSON 数组）
//   [{ workId, name, at }]，按 work_id 去重 —— 同一个审核人重复审只留最后一次时间。
//   注意它**不改**「互相覆盖」的现行模式：分数 / 意见 / 定稿答案仍然只有一个槽位
//   （reviewerName / reviewScore / reviewComment / reviewScores 仍被后提交者覆盖），
//   本列只是让员工端能看出「我被 1 位还是 2 位审核人审过」。
//   老数据该列为 NULL → 前端回落到单条 reviewerName 显示，不会白屏。
try {
  db.exec('ALTER TABLE evaluation ADD COLUMN reviewers TEXT');
} catch (_) {
  // 列已存在，忽略
}
try {
  db.exec('ALTER TABLE rating ADD COLUMN work_id TEXT');
} catch (_) {
  // 列已存在，忽略
}

// 老库升级：user_table.work_id 的唯一索引改为 COLLATE NOCASE
//   旧索引是大小写敏感的 → 'w-0009' 与 'W-0009' 能同时注册，
//   而 permission.work_id 声明了 NOCASE，会把这个人的维护工具授权"漏"给同工号的大小写变体。
//   幂等：已经是 NOCASE 就跳过；若库里已存在只差大小写的重号，则**不动索引**并告警，避免服务起不来。
try {
  const idx = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_user_table_work_id'`)
    .get();
  if (idx && !/nocase/i.test(idx.sql || '')) {
    const dup = db
      .prepare(
        `SELECT work_id FROM user_table
          WHERE work_id IS NOT NULL AND work_id != ''
          GROUP BY work_id COLLATE NOCASE HAVING COUNT(*) > 1 LIMIT 3`
      )
      .all();
    if (dup.length) {
      console.error(
        `[pingjia] ⚠️ 存在只差大小写的重复工号（${dup.map((d) => d.work_id).join('、')}），` +
          `已跳过 work_id 索引升级；请先清理重复用户再重启服务`
      );
    } else {
      db.exec(`
        DROP INDEX IF EXISTS uq_user_table_work_id;
        CREATE UNIQUE INDEX uq_user_table_work_id ON user_table(work_id COLLATE NOCASE) WHERE work_id IS NOT NULL;
      `);
      console.log('[pingjia] user_table.work_id 唯一索引已升级为大小写不敏感');
    }
  }
} catch (e) {
  // 索引升级失败不影响业务启动（新注册的工号已在入库前规范化），记录即可
  console.error('[pingjia] work_id 索引升级失败：', e.message);
}

// 启动即把库里残留的**明文口令**就地哈希化（一次性、幂等）
//   背景：哈希改造之前，user_table.pw 存的都是明文。用户并不知道自己的口令被改过，
//   所以这里不做"全部重置"，而是把明文原样换成它的哈希 —— 老账号照旧能登录。
//   没跑成功的行不会被丢弃：/api/login 里有明文兜底比较，登录成功时会顺手补哈希。
try {
  const rows = db.prepare('SELECT user_id, pw FROM user_table').all();
  const plainRows = rows.filter((r) => r.pw && !isPasswordHash(r.pw));
  if (plainRows.length) {
    const upd = db.prepare('UPDATE user_table SET pw = ? WHERE user_id = ?');
    db.transaction(() => {
      for (const r of plainRows) upd.run(hashPassword(r.pw), r.user_id);
    })();
    console.log(`[pingjia] 已把 ${plainRows.length} 条明文口令就地哈希化（登录方式不变）`);
  }
} catch (e) {
  console.error('[pingjia] 明文口令哈希化失败：', e.message);
}

// 启动即把系统管理员口令同步进库
//   背景：/api/login 就是拿 user_table 里的账号 + 口令登录的，而系统管理员那条记录也存在这张表里。
//   如果只在「后门登录」时才同步口令，那么在改完后门口令、又还没走后门登录的空档里，
//   **旧口令依然能通过普通登录口登进系统管理员**。这里启动时就对齐一次，把这个窗口关掉。
//   落库的是哈希串本身（.env 里放的就是哈希），所以两边字节级一致。
//   （记录不存在则不处理，仍由 /backdoor/login 首次登录时懒创建）
try {
  const sys = db.prepare('SELECT user_id, pw FROM user_table WHERE user_id = ?').get(BACKDOOR_USER_ID);
  if (sys && sys.pw !== BACKDOOR_PASSWORD_HASH) {
    db.prepare('UPDATE user_table SET pw = ? WHERE user_id = ?').run(
      BACKDOOR_PASSWORD_HASH,
      BACKDOOR_USER_ID
    );
    console.log('[pingjia] 系统管理员口令已与当前后门口令对齐');
  }
} catch (e) {
  console.error('[pingjia] 系统管理员口令同步失败：', e.message);
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
  // 不再向外回传 e.message：未认证可访问，避免把 SQLite 的内部报错（表结构/版本）泄露给攻击者；
  // 真实信息只打到服务端日志，由运维去看
  catch (e) {
    console.error('[pingjia] /api/gateway 数据库异常：', e.message);
    res.json({ code: 'DB_ERROR', message: '服务异常' });
  }
});
// ============================================================
// 工号规范化 —— 大小写口径统一
// ------------------------------------------------------------
// 背景：白名单判定 lookupWorkId() 是大小写**不敏感**的（内部 toLowerCase），
//   但过去落库存的是用户原样输入的串，而 permission.work_id 又声明了 COLLATE NOCASE。
//   三者口径不一致会导致：注册一个 'w-0009' 就能蹭到 'W-0009' 那个人的全部维护工具授权。
// 约定：工号一律「去首尾空格 + 转大写」后入库，凡是比较工号的地方都用这个形式。
// ============================================================
const normWorkId = (v) => String(v ?? '').trim().toUpperCase();

app.post('/api/register', (req, res) => {
  // 注册页已取消「所在党支部」这一栏：支部不再由本人选择，
  //   一律取 `server/admin-whitelist.mjs` 里该工号登记的 branch（源=党员信息表），
  //   避免党员本人选错支部导致评价 / 汇总口径错乱。
  //   body 里即便带了 branch 也**直接忽略**（后端权威来源是白名单）。
  const { user_id, pw, name, work_id, type, job } = req.body || {};
  if (!user_id || !pw || !name || !work_id)
    return res.json({ code: 'BAD_INPUT', message: '缺少必填字段（user_id/pw/name/work_id）' });
  // 与 /api/recover/reset、/api/backdoor/users 一致的口令长度（防 1 位弱口令 / 哈希爆破）
  if (pw.length < 6 || pw.length > 30)
    return res.json({ code: 'BAD_INPUT', message: '密码长度需为 6-30 位' });

  const wid = normWorkId(work_id);

  // 身份完全由工号白名单决定：注册时不再让用户选「员工 / 管理员」
  const wl = lookupWorkId(wid);
  if (!wl) {
    return res.json({ code: 'WORK_ID_NOT_IN_LIST', message: '工作证编号异常，请重新输入' });
  }
  const adminType = wl.adminType;
  // 所在党支部：白名单（党员信息表）登记值；缺失说明花名册没登记全 → 直接拒绝注册，
  //   宁可报错也不让用户自己选
  if (!wl.branch)
    return res.json({ code: 'BRANCH_NOT_IN_LIST', message: '该工作证编号未在白名单登记所在党支部，请联系系统管理员' });
  const branch = wl.branch;

  // 岗位类型必填规则：
  //   组织委员(1) / 普通党员(3) → 必填
  //   支部书记(0) / 党总支书记(2) / 分管领导(4) → 可留空，默认「没有」
  const needPosition =
    adminType === ADMIN_TYPE_ORGANIZER || adminType === ADMIN_TYPE_EMPLOYEE;
  if (needPosition && (!type || !job))
    return res.json({ code: 'POSITION_REQUIRED', message: '请填写岗位类型和岗位' });

  if (db.prepare('SELECT 1 FROM user_table WHERE user_id = ?').get(user_id))
    return res.json({ code: 'USER_EXISTS', message: '该工号已被注册' });

  // 工作证编号 work_id 必须全局唯一：已存在则提示"当前工号员工已经注册"
  // 比较用 COLLATE NOCASE，与唯一索引口径一致（'w-0009' 视为与 'W-0009' 冲突）
  if (db.prepare('SELECT 1 FROM user_table WHERE work_id COLLATE NOCASE = ?').get(wid))
    return res.json({ code: 'DUP_WORK_ID', message: '当前工号员工已经注册' });

  // 口令只以哈希形态落库（明文不在库里留任何痕迹）
  db.prepare(`INSERT INTO user_table (user_id, pw, name, work_id, admin_type, type, job, branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(user_id, hashPassword(pw), name, wid, adminType, type || null, job || null, branch);

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
  // 口令是带随机盐的哈希 → 不能再用 `WHERE pw = ?` 做等值匹配，
  // 必须先按账号取出该行，再在应用层做 scrypt 比对。
  const row = db
    .prepare(
      `SELECT user_id, pw, name, work_id, admin_type, type, job, branch FROM user_table WHERE user_id = ?`
    )
    .get(user_id);
  if (!row || !verifyPassword(pw, row.pw))
    return res.json({ code: 'BAD_CREDENTIALS', message: '工号或密码错误' });
  // 自愈：万一库里还留着明文（历史数据 / 手工写入），验证通过后立刻就地哈希化
  if (!isPasswordHash(row.pw)) {
    db.prepare('UPDATE user_table SET pw = ? WHERE user_id = ?').run(hashPassword(pw), user_id);
    console.warn(`[pingjia] 账号 ${user_id} 的口令为明文形态，已在本次登录时补做哈希`);
  }
  // 登录后补齐「本人所在支部」当年的年度红线扣分记录（每年第一次登录即自动生成）
  //   幂等：已有 (work_id, year) 的记录不会重复插入；失败不影响登录
  try {
    if (row.branch) ensureDisciplineForYear(row.branch, new Date().getFullYear());
  } catch (e) {
    console.error('[pingjia] 登录后补齐 discipline 记录失败：', e);
  }
  // 登录成功 → 签发会话 token（前端存 localStorage，之后每个请求带 Bearer 头）
  const { pw: _pw, ...user } = row;
  res.json({ code: 'OK', token: createSession(user_id), user: withUserMeta(user) });
});

// 后门登录：口令取自 BACKDOOR_PASSWORD_HASH（.env 里只存哈希）→ 系统管理员（admin_type=9）
//   跟普通登录完全隔离：失败提示相同，不暴露"是否存在 superadmin 用户"。
//   首次登录时若 user_table 里没有系统用户，按需插一条（work_id='superadmin' / admin_type=9），
//   之后所有走该入口的会话都挂到这个 user_id 下。
app.post('/api/backdoor/login', (req, res) => {
  const { user, password } = req.body || {};
  if (user !== BACKDOOR_WORK_ID || !verifyPassword(password, BACKDOOR_PASSWORD_HASH)) {
    return res.json({ code: 'BAD_CREDENTIALS', message: '工号或密码错误' });
  }
  // 懒注册系统用户：避免重启后丢失（user_id 主键冲突时 IGNORE）
  db.prepare(
    `INSERT OR IGNORE INTO user_table (user_id, pw, name, work_id, admin_type, type, job, branch)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, '__system__')`
  ).run(BACKDOOR_USER_ID, BACKDOOR_PASSWORD_HASH, '系统管理员', BACKDOOR_WORK_ID, ADMIN_TYPE_SYSTEM);
  // 口令若被环境变量改过，同步更新库内字段（不影响普通业务接口）
  db.prepare(`UPDATE user_table SET pw = ? WHERE user_id = ?`).run(
    BACKDOOR_PASSWORD_HASH,
    BACKDOOR_USER_ID
  );
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
// 忘记密码（公开接口，用户此时尚未登录）
// ------------------------------------------------------------
// ⚠️ 安全边界 —— 本功能按需求做成**自助式，不校验任何身份凭据**：
//   只要「姓名 + 工作证编号」与库里一致，就能把该账号的口令重置掉。
//   而工作证编号是可枚举的（W-0001 ~ W-0048），姓名在单位内部也基本公开，
//   所以实际上「知道某人姓名和工号的人，就能接管这个账号」——
//   可以替他提交自评、以审核人身份定稿别人对他的评价。
//   这是刻意的设计取舍，不是疏漏；若要收紧，可选做法：
//     · 增加一个只有本人知道的校验项（入职日期 / 手机尾号 / 自定义问题）
//     · 改为「提交申请 → 系统管理员在 /backdoor 审批后生效」
//   已做的下限保护（都在下面两个接口里）：
//     ① **只能改口令，不能改登录名**：登录名由第一步查出来只作展示，
//        接口忽略请求体里的 user_id —— 少一个"抢别人账号名"的口子
//     ② 系统管理员（admin_type=9）被排除：否则这会变成一个公开的后门接管入口
//     ③ 「工号不存在」与「姓名对不上」返回同一个错误，不让它变成员工信息探测器
//     ④ 改完立即作废该人全部会话（旧 token 失效）
//     ⑤ 口令只以哈希落库：接口不读、不比对旧口令，也就"看不到"原口令，只能重置
// ============================================================

// 第一步：用「姓名 + 工作证编号」换回登录账号（只回登录名，不回任何其它字段）
app.post('/api/recover/lookup', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const wid = normWorkId(req.body?.work_id);
  if (!name || !wid) return res.json({ code: 'BAD_INPUT', message: '请填写姓名和工作证编号' });

  const u = db
    .prepare('SELECT user_id, name, work_id, admin_type FROM user_table WHERE work_id COLLATE NOCASE = ?')
    .get(wid);
  if (!u || u.name !== name)
    return res.json({ code: 'NOT_MATCH', message: '姓名或工作证编号不正确' });
  if (u.admin_type === ADMIN_TYPE_SYSTEM)
    return res.json({ code: 'FORBIDDEN', message: '该账号不支持自助找回，请联系系统管理员' });

  res.json({ code: 'OK', data: { user_id: u.user_id, name: u.name, work_id: u.work_id } });
});

// 第二步：只提交新密码，覆盖 user_table 里原来那行的 pw（登录名保持不变）
app.post('/api/recover/reset', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const wid = normWorkId(req.body?.work_id);
  const pw = String(req.body?.pw ?? req.body?.password ?? '');
  if (!name || !wid || !pw)
    return res.json({ code: 'BAD_INPUT', message: '姓名 / 工作证编号 / 新密码都不可为空' });
  if (pw.length < 6 || pw.length > 30)
    return res.json({ code: 'BAD_INPUT', message: '新密码长度需为 6-30 位' });

  const u = db
    .prepare('SELECT user_id, name, work_id, admin_type FROM user_table WHERE work_id COLLATE NOCASE = ?')
    .get(wid);
  if (!u || u.name !== name)
    return res.json({ code: 'NOT_MATCH', message: '姓名或工作证编号不正确' });
  if (u.admin_type === ADMIN_TYPE_SYSTEM)
    return res.json({ code: 'FORBIDDEN', message: '该账号不支持自助找回，请联系系统管理员' });

  const tx = db.transaction(() => {
    // 只动 pw 一列：登录名（user_id 主键）不受影响，也就不存在"占用别人账号名"的可能
    db.prepare('UPDATE user_table SET pw = ? WHERE work_id COLLATE NOCASE = ?')
      .run(hashPassword(pw), wid);
    // 口令一变，之前的会话全部作废（会话是挂在 user_id 上的）
    db.prepare('DELETE FROM session WHERE user_id = ?').run(u.user_id);
  });
  tx();
  res.json({ code: 'OK', data: { user_id: u.user_id } });
});

// ============================================================
// 系统维护工具（员工信息维护 / 审核关系维护 / 个人问卷维护）＋ 权限管理
// ------------------------------------------------------------
// 鉴权：系统管理员(9) 恒可用；其他账号要能在 permission 表里查到对应授权。
//   授权由系统管理员在 /backdoor →「权限管理」页在线增删
//   （接口见下面的 GET/POST/DELETE /api/backdoor/permissions）。
//   与业务接口完全隔离：这些端点不在 SELF_EVAL_TYPES / BASIC_RATING_TYPES 里，
//   → 不会污染任何业务范围。
// 注：端点路径仍是 /api/backdoor/*（历史命名，未改动以免影响既有部署），
//   但现在被授权的普通账号也能调用 —— 他们从主应用侧边栏进入
//   /user-admin、/review-assign、/form-override 三个页面。
// ============================================================

// ---- 可授予的维护工具清单（**后端唯一真源**）----
//   前端从 GET /api/backdoor/permissions 读这份清单，不在前端硬编码，避免两边对不上。
//   注意：「权限管理」故意不在这里 —— 它硬校验 admin_type=9，
//   任何人都授不到它，防止越权自我扩散。
const GRANTABLE_TOOLS = [
  {
    key: 'userAdmin',
    label: '员工信息维护',
    desc: '新增 / 修改用户、改身份、重置密码、删除用户',
  },
  {
    key: 'reviewAssign',
    label: '审核关系维护',
    desc: '指派谁审核谁（可查看全体员工名单）',
  },
  {
    key: 'formOverride',
    label: '个人问卷维护',
    desc: '给个别员工定制履职贡献问卷（改题干 / 选项 / 分值 / 增删题 / 调序）',
  },
];
const TOOL_KEYS = GRANTABLE_TOOLS.map((t) => t.key);
const isToolKey = (t) => TOOL_KEYS.includes(t);

// ---- permission 表读写：每次实时查库 → 授权/收回立刻生效，不用重启，也不怕脏数据 ----

// 某工号是否被授予了某个工具。
// 只判表里的授权，不含系统管理员 —— 由 canUseTool 叠加 admin_type===9。
// 用函数声明（会提升），文件里任何位置都能引用，不受 const 初始化顺序影响
function hasToolGrant(workId, tool) {
  if (!workId || !isToolKey(tool)) return false;
  return !!db
    .prepare('SELECT 1 FROM permission WHERE work_id = ? AND tool = ?')
    .get(String(workId).trim(), tool);
}

// 是否可用某个维护工具
function canUseTool(u, tool) {
  if (!u) return false;
  if (u.admin_type === ADMIN_TYPE_SYSTEM) return true;
  return hasToolGrant(u.work_id, tool);
}

// 生成鉴权中间件；一个端点可挂多个工具，任一命中即放行
function requireTool(...tools) {
  return (req, res, next) => {
    if (tools.some((t) => canUseTool(req.user, t))) return next();
    return res.status(403).json({ code: 'FORBIDDEN', message: '没有该维护工具的权限' });
  };
}

const requireUserAdmin = requireTool('userAdmin'); // 员工信息维护（写）
const requireReviewAssign = requireTool('reviewAssign'); // 审核关系维护（读写）
const requireUserRoster = requireTool('userAdmin', 'reviewAssign'); // 只读员工名单：两个工具都要用

// 「权限管理」端点专用：硬校验系统管理员，**不参与授权体系**
// （即：权限管理永远是超级管理员专属，授不出去）
const requireSystemAdmin = (req, res, next) => {
  if (req.user?.admin_type !== ADMIN_TYPE_SYSTEM)
    return res.status(403).json({ code: 'FORBIDDEN', message: '仅系统管理员可管理权限' });
  next();
};

// 全部用户列表（系统管理员自动维护审核关系时做下拉/校验用）
//   不含「系统管理员」本人：本接口是「员工信息维护 / 审核关系 / 权限管理」三个页面
//   所有选人下拉的数据源，它一进名单，前端按姓名或工号就能匹配到并加载出它的资料。
//   两个条件都判：admin_type=9 与 work_id='superadmin' 命中任一即排除 ——
//   双保险，避免将来两者不一致（身份被改成别的 / 工号被改成别的）时漏网。
app.get('/api/backdoor/users', requireUserRoster, (req, res) => {
  const rows = db
    .prepare(
      `SELECT user_id, name, work_id, admin_type, type, job, branch
         FROM user_table
        WHERE work_id IS NOT NULL AND work_id != ''
          AND admin_type != ?
          AND work_id COLLATE NOCASE != ?
        ORDER BY admin_type, work_id`
    )
    .all(ADMIN_TYPE_SYSTEM, BACKDOOR_WORK_ID);
  res.json({ code: 'OK', data: rows });
});

// 审核关系列表（联表取姓名 + admin_type + branch，便于人眼核对）
//   每次进页面都实时查：关系可以先于账号建好（工号未注册也能存），
//   对方**注册后下次打开本页即显示姓名** —— 不需要任何刷新 / 迁移动作。
//   JOIN 用 COLLATE NOCASE：工号口径与注册一致（大小写不敏感），
//   防止历史上存进来的小写工号匹配不到已注册的大写工号。
app.get('/api/backdoor/assignments', requireReviewAssign, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.reviewer_work_id, a.target_work_id, a.created_at,
              r.name AS reviewer_name, r.admin_type AS reviewer_admin_type, r.branch AS reviewer_branch,
              t.name AS target_name,   t.admin_type AS target_admin_type,   t.branch AS target_branch
         FROM review_assignment a
         LEFT JOIN user_table r ON r.work_id COLLATE NOCASE = a.reviewer_work_id COLLATE NOCASE
         LEFT JOIN user_table t ON t.work_id COLLATE NOCASE = a.target_work_id COLLATE NOCASE
        ORDER BY a.reviewer_work_id, a.target_work_id`
    )
    .all();
  res.json({ code: 'OK', data: rows });
});

// 批量新增 / 幂等写入审核关系
//   body: { reviewer: 'W-0001', reviewees: ['W-0007', 'W-0008', ...] }
//   - 校验：只要求**工号非空**、被审核人 ≠ 审核人；
//     **不再要求该工号已注册** —— 允许先把关系建上（人还没注册 / 工号先录进来），
//     对方注册后关系自动生效。列表里未注册的工号只显示工号、不显示姓名。
//   - 校验：审核人不能是「被评对象」(admin_type IN BASIC_RATING_TYPES)
//           因为这些人需要走「组织委员/党总支书记」的评价，不参与审核关系
//   - 已存在的关系（PK 冲突）走 IGNORE，不报错
//   - 返回 { code, added, alreadyExists, invalidWorkIds }
app.post('/api/backdoor/assignments', requireReviewAssign, (req, res) => {
  const { reviewer, reviewees } = req.body || {};
  if (!reviewer || !Array.isArray(reviewees) || reviewees.length === 0)
    return res.json({ code: 'BAD_INPUT', message: '请填写审核人 + 至少一个被审核人' });

  // 收集所有工号（审核人 + 被审核人）
  //   normWorkId = 去空格 + 转大写，与注册 / 登录落库的工号口径完全一致：
  //   这样「先建关系、后注册」时两边一定能对上（列表显示出姓名、审核范围生效）
  const rvId = normWorkId(reviewer);
  const tgIds = reviewees.map((x) => normWorkId(x)).filter(Boolean);
  const allIds = Array.from(new Set([rvId, ...tgIds]));
  if (allIds.some((x) => !x))
    return res.json({ code: 'BAD_INPUT', message: '工号不能为空' });

  // 不校验「是否已注册」：没注册的工号也照样建关系（对方注册后自动生效）
  // 不限制审核人身份：任何人可以是审核人、任何人可以是被审核人（admin_type=0/1/2/3/9 都行）
  // 工号写错的后果由系统管理员自己承担（列表里会只显示工号、看不到姓名）

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
  const pairs = tgIds.map((t) => [rvId, t]).filter(([, t]) => t && t !== rvId);
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
app.delete('/api/backdoor/assignments', requireReviewAssign, (req, res) => {
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
        // 与写入同一口径：统一 normWorkId
        deleted += del.run(normWorkId(p.reviewer), normWorkId(p.reviewee)).changes;
      }
    } else if (reviewer) {
      // 方式 2 / 3：单审核人
      const rv = normWorkId(reviewer);
      if (Array.isArray(reviewees) && reviewees.length) {
        const tgs = reviewees.map((x) => normWorkId(x)).filter(Boolean);
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

// 后门：员工信息修改（**仅修改**，不再支持新建）
// ------------------------------------------------------------
// 设计变更（2026-10-19）：
//   · 取消「新建账号」功能 —— 一律通过修改现有记录来调整；
//     想要新账号需要先在注册白名单里登记好，再在「员工信息维护」里搜索该工号 → 修改。
//   · 系统管理员在表单里**可以改工号**（改名）：work_id 是员工的主键，这里
//     改成"原工号定位行 + 新工号落库"的 UPDATE 模式；新工号不能撞别人。
//   · 其它被授权账号不能改工号（最容易出问题：把别人的工号改成不存在的号，
//     再说"账号消失"），仅系统管理员能改。
//
//   body: {
//     originalWorkId,            // 必填：被修改员工的"原工号"，用于定位行
//     user_id, name, work_id,    // work_id 是新工号
//     pw?, admin_type, type?, job?, branch,
//   }
//   - admin_type 允许 0/1/2/3/4；**9 只有系统管理员本人能设**
//     （防止「员工信息维护」等价于系统管理员：被授权人新建一个 admin_type=9 的
//      账号再登录，即可通过 requireSystemAdmin 调用「权限管理」实现越权自我扩散）
//   - 改了密码 / 换了登录账号 → 立即作废该人全部会话
//     （旧 token 原本能一直用到 7 天 TTL 到期）
app.post('/api/backdoor/users', requireUserAdmin, (req, res) => {
  const {
    originalWorkId,
    user_id, pw, name, work_id,
    admin_type, type, job, branch,
  } = req.body || {};

  // 必填：登录账号 / 姓名 / 新工号
  if (!user_id || !name || !work_id)
    return res.json({ code: 'BAD_INPUT', message: '登录账号 / 姓名 / 工号 不可为空' });
  // 必填：原工号（前端必须先在「查询 / 加载用户」区加载要修改的人）
  if (!originalWorkId)
    return res.json({
      code: 'BAD_INPUT',
      message: '请先在「查询 / 加载用户」区加载要修改的用户，再保存',
    });

  const at = Number(admin_type);
  if (![ADMIN_TYPE_LEADER, ADMIN_TYPE_ORGANIZER, ADMIN_TYPE_SECRETARY, ADMIN_TYPE_EMPLOYEE, ADMIN_TYPE_DIRECTOR, ADMIN_TYPE_SYSTEM].includes(at))
    return res.json({ code: 'BAD_INPUT', message: '身份必须是 0=支部书记 / 1=组织委员 / 2=党总支书记 / 3=普通党员 / 4=分管领导 / 9=系统管理员' });

  // 提权闸门：只有系统管理员本人可以授予 / 修改「系统管理员」身份
  if (at === ADMIN_TYPE_SYSTEM && req.user?.admin_type !== ADMIN_TYPE_SYSTEM)
    return deny(res, '只有系统管理员可以设置「系统管理员」身份');

  const origWid = normWorkId(originalWorkId);
  const wid = normWorkId(work_id);
  const trimmedUserId = String(user_id).trim();

  // 不允许把已有用户改成 superadmin（防误操作覆盖系统管理员）
  if (!isBackdoorWorkId(wid) && trimmedUserId === BACKDOOR_USER_ID) {
    return res.json({ code: 'FORBIDDEN', message: '不可把任意用户改成系统管理员 user_id' });
  }
  // 系统管理员那条记录只能由系统管理员本人维护
  // （否则被授权人能重置它的密码 / 改它的登录名，再借普通登录口 /api/login 登进去）
  if (isBackdoorWorkId(wid) && req.user?.admin_type !== ADMIN_TYPE_SYSTEM)
    return deny(res, '系统管理员账号只能由系统管理员本人维护');

  // 按原工号定位行（必存在 —— 不存在说明前端没加载过）
  const existing = db
    .prepare('SELECT user_id, admin_type, work_id FROM user_table WHERE work_id COLLATE NOCASE = ?')
    .get(origWid);
  if (!existing) {
    return res.json({
      code: 'NOT_FOUND',
      message: `原工号 ${origWid} 在用户表中找不到，请刷新后重新加载该用户再保存`,
    });
  }

  // 「修改身份」门禁：**只有系统管理员本人**可以改动已有账号的 admin_type。
  //   · 2026-10-19 起撤销原「党总支书记」例外。
  //   · 改值才挡；保持不变不算"改"，其它字段仍允许 userAdmin 授权人维护。
  if (existing.admin_type !== at && req.user?.admin_type !== ADMIN_TYPE_SYSTEM) {
    return deny(res, '只有系统管理员可以修改身份（admin_type）');
  }

  // 「修改工号」门禁：**只有系统管理员本人**可以改动 work_id。
  //   · 改值才挡（保持不变不算"改"）。
  //   · 新工号不能撞别人的记录（自己这条不算）。
  if (wid !== existing.work_id) {
    if (req.user?.admin_type !== ADMIN_TYPE_SYSTEM) {
      return deny(res, '只有系统管理员可以修改工号（work_id）');
    }
    const conflict = db
      .prepare('SELECT 1 FROM user_table WHERE work_id COLLATE NOCASE = ? AND work_id COLLATE NOCASE != ?')
      .get(wid, origWid);
    if (conflict) {
      return res.json({ code: 'WORK_ID_CONFLICT', message: `工号 ${wid} 已被其它用户占用` });
    }
  }

  // 「登录账号 user_id」冲突检查
  if (trimmedUserId !== existing.user_id) {
    const conflict = db
      .prepare('SELECT 1 FROM user_table WHERE user_id = ? AND work_id COLLATE NOCASE != ?')
      .get(trimmedUserId, origWid);
    if (conflict)
      return res.json({ code: 'USER_ID_CONFLICT', message: `登录账号 ${trimmedUserId} 已被其它用户占用` });
  }

  // 所在支部：表单选了就以表单为准；没选则回落到白名单（党员信息表）里登记的支部
  const finalBranch = branch || lookupWorkId(wid)?.branch || '';
  if (!finalBranch)
    return res.json({ code: 'BAD_INPUT', message: '所在支部不可为空：该工号未在白名单登记支部，请手动选择' });

  // ===== UPDATE（统一路径，不再有 INSERT）=====
  const sql = `UPDATE user_table
                  SET user_id = ?, name = ?, work_id = ?, admin_type = ?, type = ?, job = ?, branch = ?
                      ${pw ? ', pw = ?' : ''}
                WHERE work_id COLLATE NOCASE = ?`;
  const args = [trimmedUserId, String(name).trim(), wid, at, type || null, job || null, finalBranch];
  if (pw) args.push(hashPassword(String(pw)));
  args.push(origWid);
  const revoke = Boolean(pw) || trimmedUserId !== existing.user_id;
  const tx = db.transaction(() => {
    db.prepare(sql).run(...args);
    // 会话按 user_id 挂靠，用改动前的 user_id 删
    if (revoke) db.prepare('DELETE FROM session WHERE user_id = ?').run(existing.user_id);
  });
  tx();
  return res.json({ code: 'OK', action: 'updated', sessionsRevoked: revoke });
});

// 后门：删除用户（按工号）
//   - 同时清掉该用户的所有 session（避免 token 仍能"鉴权"出已不存在的用户）
//   - 拒绝删除系统管理员（work_id='superadmin'）
app.delete('/api/backdoor/users/:workId', requireUserAdmin, (req, res) => {
  const workId = normWorkId(req.params.workId);
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '请提供 workId' });
  // 大小写不敏感：'SuperAdmin' 这类变体同样不能被删
  if (isBackdoorWorkId(workId))
    return res.json({ code: 'FORBIDDEN', message: '不能删除系统管理员' });
  // 一律用 COLLATE NOCASE 定位：老库里可能存在小写工号，
  // 用敏感比较会导致"删了但没删掉"，而 user_table 没删掉 → 该 token 仍然有效
  const user = db.prepare('SELECT user_id FROM user_table WHERE work_id COLLATE NOCASE = ?').get(workId);
  if (!user) return res.json({ code: 'NOT_FOUND', message: '用户不存在' });
  const tx = db.transaction(() => {
    db.prepare(
      'DELETE FROM review_assignment WHERE reviewer_work_id COLLATE NOCASE = ? OR target_work_id COLLATE NOCASE = ?'
    ).run(workId, workId);
    db.prepare('DELETE FROM session WHERE user_id = ?').run(user.user_id);
    // 顺带清掉这个人被授予的维护工具权限，避免留下悬空授权
    db.prepare('DELETE FROM permission WHERE work_id COLLATE NOCASE = ?').run(workId);
    db.prepare('DELETE FROM user_table WHERE work_id COLLATE NOCASE = ?').run(workId);
  });
  tx();
  res.json({ code: 'OK' });
});

// ============================================================
// 权限管理（仅系统管理员）—— permission 表的增 / 删 / 查
// ------------------------------------------------------------
// 用途：把「系统维护工具」开放给某个账号，或从某个账号收回。
//   - 可授予的工具清单 = GRANTABLE_TOOLS；「权限管理」本身不在其中，永远授不出去
//   - 被授予人从主应用侧边栏进入对应页面；系统管理员自己的入口仍在 /backdoor
//   - 收回立即生效（所有接口实时查表）；但本人已登录的会话里，
//     侧边栏菜单要等他重新登录后才会消失，这期间点进去接口会返回 403
// ============================================================

// 查：可授予的工具清单 + 当前全部授权（连姓名 / 授予人姓名一起带出，方便前端直接展示）
app.get('/api/backdoor/permissions', requireSystemAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.work_id,
              COALESCE(u.name, p.name)      AS name,
              p.tool,
              p.granted_by,
              COALESCE(g.name, p.granted_by) AS granted_by_name,
              p.created_at
         FROM permission p
         LEFT JOIN user_table u ON u.work_id = p.work_id
         LEFT JOIN user_table g ON g.work_id = p.granted_by
        ORDER BY p.work_id, p.tool`
    )
    .all();
  res.json({
    code: 'OK',
    data: {
      tools: GRANTABLE_TOOLS,
      // 只回清单内的工具：即使库里被手工塞了脏数据也不往外露
      grants: rows.filter((r) => isToolKey(r.tool)),
    },
  });
});

// 增：body = { work_id, tools: ['userAdmin', ...] }（可一次开放多个功能）
app.post('/api/backdoor/permissions', requireSystemAdmin, (req, res) => {
  const workId = String(req.body?.work_id || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '请选择要开放的账号' });
  if (isBackdoorWorkId(workId))
    return res.json({ code: 'BAD_INPUT', message: '系统管理员已拥有全部功能，无需开放' });

  const rawTools = Array.isArray(req.body?.tools) ? req.body.tools : [];
  const tools = [...new Set(rawTools.map((t) => String(t).trim()))].filter(Boolean);
  if (!tools.length) return res.json({ code: 'BAD_INPUT', message: '请至少勾选一个功能' });
  const unknown = tools.filter((t) => !isToolKey(t));
  if (unknown.length)
    return res.json({ code: 'BAD_INPUT', message: `不认识的功能：${unknown.join('、')}` });

  // 被授予人必须已注册，否则授权挂不到人身上。
  // 用 COLLATE NOCASE 查（工号在库里可能是小写），并以库里那份原始写法落库 ——
  // 前端是拿 user_table 的 work_id 去比对授权记录的，两边必须完全一致
  const target = db
    .prepare('SELECT name, work_id FROM user_table WHERE work_id COLLATE NOCASE = ?')
    .get(workId);
  if (!target) return res.json({ code: 'NOT_FOUND', message: '该工号尚未注册，无法开放功能' });
  const targetWorkId = target.work_id;

  // 重复开放同一功能 = 更新 name / granted_by，保留原始 created_at
  const stmt = db.prepare(
    `INSERT INTO permission (work_id, name, tool, granted_by, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(work_id, tool)
     DO UPDATE SET name = excluded.name, granted_by = excluded.granted_by`
  );
  const t = now();
  const grantedBy = String(req.user.work_id || '');
  const tx = db.transaction(() => {
    for (const tool of tools) stmt.run(targetWorkId, target.name || '', tool, grantedBy, t);
  });
  tx();
  res.json({ code: 'OK', data: { work_id: targetWorkId, tools } });
});

// 删（收回）：body = { work_id, tools?: [...] }
//   tools 省略 / 为空 = 收回该人的全部功能；指定则只收回列出的几项
app.delete('/api/backdoor/permissions', requireSystemAdmin, (req, res) => {
  const workId = String(req.body?.work_id || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '请指定要收回的账号' });

  const rawTools = Array.isArray(req.body?.tools) ? req.body.tools : [];
  const tools = [...new Set(rawTools.map((t) => String(t).trim()))].filter(isToolKey);

  let deleted = 0;
  if (tools.length) {
    const del = db.prepare('DELETE FROM permission WHERE work_id = ? AND tool = ?');
    const tx = db.transaction(() => {
      for (const tool of tools) deleted += del.run(workId, tool).changes;
    });
    tx();
  } else {
    deleted = db.prepare('DELETE FROM permission WHERE work_id = ?').run(workId).changes;
  }
  res.json({ code: 'OK', data: { deleted } });
});

// ============================================================
// 清空业务数据（不可恢复）—— 仅系统管理员
// ------------------------------------------------------------
// 语义：清空库里**除了超级管理员那条记录以外**的一切 ——
//   员工账号、自评、履职评分、基础积分、荣誉、扣分、审核关系、
//   个人卷子、工具授权、登录会话，全部删除；user_table 只留 superadmin。
// 前端 /backdoor 顶栏「清除数据」按钮必须连过 3 次确认才会调到这里，
//   但**这里才是真正的硬边界**：只认 admin_type===9，前端怎么绕都没用。
// 安全设计：
//   ① requireSystemAdmin 拦非 9 身份；
//   ② 超级管理员记录不存在时直接拒绝（清了就再也没人能进后台）；
//   ③ 整库清空放进**单个事务**，任何一步失败全部回滚，绝不留"清了一半"的库；
//   ④ 操作人 + 各表清除条数写进服务端日志，便于事后追溯。
// ============================================================
// 「清除数据」的二次口令 —— 只从环境变量 / server/.env 读**哈希**，源码里不出现任何明文。
//   与后门口令同一套 scrypt 方案（node hash-password.mjs <口令> 生成后粘进 .env）。
//   ⚠️ 没配 / 配的不是合法哈希 → **不阻断启动**（不再重演"少配一个变量整站起不来"的事故），
//      改为在调用端点时拒绝执行：fail-closed —— 清不掉，但网站照常对外服务。
const CLEAR_DATA_PASSWORD_HASH = (() => {
  const raw = String(process.env.CLEAR_DATA_PASSWORD_HASH || '').trim();
  if (!raw) return '';
  if (!isPasswordHash(raw)) {
    console.error(
      '[pingjia] ⚠️ CLEAR_DATA_PASSWORD_HASH 不是合法的哈希串，「清除数据」将被拒绝执行。' +
        '请执行 node hash-password.mjs 生成哈希后再填进 server/.env',
    );
    return '';
  }
  return raw;
})();

app.post('/api/backdoor/clear-data', requireSystemAdmin, (req, res) => {
  // ① 兜底：口令没配好 → 直接拒绝（宁可清不掉，也不能出现"没口令也能清"）
  if (!CLEAR_DATA_PASSWORD_HASH) {
    return res.status(500).json({
      code: 'CLEAR_PASSWORD_NOT_CONFIGURED',
      message:
        '未配置「清除数据」口令，已拒绝执行（请在 server/.env 配 CLEAR_DATA_PASSWORD_HASH）',
    });
  }
  // ② 校验本次输入的口令（前端第 3 次确认弹窗里填的那个）
  const password = String(req.body?.password ?? '');
  if (!password) {
    return res.json({ code: 'BAD_INPUT', message: '请输入清除口令' });
  }
  if (!verifyPassword(password, CLEAR_DATA_PASSWORD_HASH)) {
    console.warn(`[pingjia] ⚠️ 系统管理员 ${req.user?.user_id} 清除数据时口令校验失败`);
    return res.status(403).json({ code: 'BAD_CLEAR_PASSWORD', message: '清除口令不正确' });
  }

  // 整表清空清单（不含 user_table：它要保留超级管理员，单独处理）
  const TABLES_TO_WIPE = [
    'evaluation', // 履职贡献自评
    'rating', // 基础积分（组织委员评）
    'credit', // 个人荣誉（一年一条）
    'discipline', // 行为扣分（一年一条）
    'session', // 登录会话（所有人被踢下线）
    'review_assignment', // 谁审谁
    'form_override', // 个人专属卷子
    'permission', // 系统维护工具授权
  ];

  // 兜底：超级管理员那条记录必须还在，否则清完之后无人能进后台
  const sysRow = db
    .prepare('SELECT user_id FROM user_table WHERE user_id = ?')
    .get(BACKDOOR_USER_ID);
  if (!sysRow) {
    return res.status(500).json({
      code: 'NO_BACKDOOR_USER',
      message: '超级管理员记录不存在，已拒绝清空（否则将无人可进入后台）',
    });
  }

  const cleared = {};
  // 一个事务包住全部删除：失败 → 整体回滚
  const tx = db.transaction(() => {
    for (const t of TABLES_TO_WIPE) {
      cleared[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
    }
    // user_table：只删**不是**超级管理员的行（参数绑定，不拼字符串）
    cleared.user_table = db
      .prepare('DELETE FROM user_table WHERE user_id != ?')
      .run(BACKDOOR_USER_ID).changes;
  });

  try {
    tx();
  } catch (e) {
    console.error('[pingjia] clear-data 失败，已回滚：', e.message);
    return res.status(500).json({
      code: 'DB_ERROR',
      message: '清空失败，数据库未做任何修改',
    });
  }

  console.warn(
    `[pingjia] ⚠️ 系统管理员 ${req.user?.user_id} 清空了业务数据：`,
    JSON.stringify(cleared),
  );
  res.json({ code: 'OK', data: { cleared } });
});

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ============================================================
// 个人专属卷子（form_override）—— 数据库版
// ------------------------------------------------------------
// 背景：以前「某人题目与岗位模板不同」只能由开发者手改
//   src/lib/forms-data.mjs 的 USER_FORM_OVERRIDES 再重新打包部署。
//   现在改为落库：系统管理员在 /backdoor 的「个人问卷维护」页
//   在线给某个员工单独定制一份履职贡献问卷，保存即生效，无需重新部署。
//
// 存储模型：**整份卷子**，而不是「差异补丁」
//   form_def 里是编辑完成后的完整 formDef：{ sections: [ { title, items: [...] } ] }
//   理由：个人卷子会被频繁调整（增题 / 删题 / 改题干 / 改分值 / 重排），
//         存补丁需要每次都在基础模板上重新演算，容易出现「改一处、顶掉另一处」；
//         存整份则所见即所得，编辑器保存什么、员工页就渲染什么。
//
// 生效优先级（前端 resolveFormDef 实现，此处仅存原始数据）：
//   ① 已审核记录 → evaluation.scores.snapshot（历史题干，最高优先，永不改）
//   ② 本表 form_override（work_id 命中 且 position 与员工当前岗位一致）
//   ③ 代码版 USER_FORM_OVERRIDES（forms-data.mjs 手改）
//   ④ 14 套岗位基础模板
//
// 失效规则（fail-safe）：
//   - 换岗（position 不一致）→ 本行自动跳过，回落基础模板（需重新保存才生效）
//   - 员工未注册 / 岗位被改 → 保存时直接拒绝，避免把卷子挂错人
// ============================================================

// 个人问卷维护的鉴权：统一走 canUseTool(u, 'formOverride')
//   - 系统管理员(9) 恒可用；其他账号看 permission 表里有没有 formOverride 授权
//   - 入口分两条，功能是同一个组件（components/FormOverridePanel.jsx）：
//       系统管理员 → /backdoor（独立布局，内部自检 admin_type=9）
//       被授权人   → 侧边栏「个人问卷维护」/form-override
//   - 注意：读取接口（GET /api/form-overrides/:workId）对「员工查自己」始终开放，
//     自评页要用它拿自己的个人问卷

// 校验并规整前端提交的 formDef：只保留认识的字段（防止脏数据入库 / 前端塞私货）
// 返回 { formDef } 或 { error: '...' }
function sanitizeFormDef(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections))
    return { error: '卷子格式不合法（缺少 sections 数组）' };
  const sections = [];
  const seenKeys = new Set();
  for (const sec of raw.sections) {
    if (!sec || typeof sec !== 'object') continue;
    const title = String(sec.title ?? '').trim();
    if (!title) return { error: '章节名称不能为空' };
    if (sections.some((s) => s.title === title))
      return { error: `章节名称「${title}」重复` };
    if (!Array.isArray(sec.items)) return { error: `章节「${title}」缺少题目列表` };

    const items = [];
    for (const it of sec.items) {
      if (!it || typeof it !== 'object') continue;
      const key = String(it.key ?? '').trim();
      const label = String(it.label ?? '').trim();
      if (!key) return { error: `章节「${title}」中有题目缺少题号(key)` };
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key))
        return { error: `题号「${key}」只能由字母 / 数字 / 下划线 / 连字符组成（不超过 64 位）` };
      if (label.length > 500) return { error: `题号「${key}」的题干过长（最多 500 字）` };
      if (!label) return { error: `题号「${key}」的题干不能为空` };
      if (seenKeys.has(key)) return { error: `题号「${key}」在整个卷子中重复` };
      seenKeys.add(key);

      if (it.type === 'fill') {
        const unitScore = Number(it.unitScore);
        if (!Number.isFinite(unitScore))
          return { error: `题目「${key}」的单次分值必须是数字` };
        items.push({
          key,
          type: 'fill',
          label,
          unitScore,
          unit: String(it.unit ?? '项').trim() || '项',
          hasReason: it.hasReason !== false,
        });
      } else {
        const options = (Array.isArray(it.options) ? it.options : [])
          .filter((o) => o && o.value !== undefined && o.value !== null && String(o.value).trim())
          .map((o) => ({
            value: String(o.value).trim(),
            label: String(o.label ?? '').trim(),
            score: Number(o.score) || 0,
          }));
        if (!options.length)
          return { error: `选择题「${key}」至少需要 1 个选项` };
        if (new Set(options.map((o) => o.value)).size !== options.length)
          return { error: `选择题「${key}」的选项值重复` };
        items.push({ key, label, options });
      }
    }
    if (!items.length) continue; // 整段没题 → 直接丢弃该段
    sections.push({ title, items });
  }
  if (!sections.length) return { error: '整份卷子至少要保留 1 道题' };
  return { formDef: { sections } };
}

// 可被定制卷子的员工名单（供维护页选人）
//   - 覆盖全部已注册用户（含支部书记 / 党总支书记）
//   - 不含「系统管理员」本人：本接口是维护页选人下拉的数据源，
//     它一进名单，维护者按姓名 / 工号就能调出并改写它的问卷
//   - customized 附带「已定制过」的 work_id，前端用来打「已定制」标签
app.get('/api/form-overrides/members', (req, res) => {
  if (!canUseTool(req.user, 'formOverride'))
    return deny(res, '仅系统管理员可维护个人问卷');
  const rows = db
    .prepare(
      `SELECT work_id, name, job, type, branch, admin_type
         FROM user_table
        WHERE work_id IS NOT NULL AND work_id != ''
          AND admin_type != ?
          AND work_id COLLATE NOCASE != ?
        ORDER BY branch, work_id`
    )
    .all(ADMIN_TYPE_SYSTEM, BACKDOOR_WORK_ID);
  const customized = db
    .prepare('SELECT work_id FROM form_override')
    .all()
    .map((r) => r.work_id);
  res.json({
    code: 'OK',
    data: {
      list: rows.map((r) => ({
        work_id: r.work_id,
        name: r.name,
        position: r.job || '',
        positionType: r.type || '',
        branch: r.branch,
        adminType: r.admin_type,
      })),
      customized,
    },
  });
});

// 读取某人的个人卷子
//   鉴权：维护者可读任意人；普通登录用户只能读自己（自评页会用这条接口）
//   返回 data = null 表示「未定制过」→ 前端回落基础模板
app.get('/api/form-overrides/:workId', (req, res) => {
  const workId = String(req.params.workId || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '缺少 workId' });
  const me = req.user;
  if (!canUseTool(me, 'formOverride') && me.work_id !== workId)
    return deny(res, '只能查看自己的问卷');

  const row = db
    .prepare('SELECT * FROM form_override WHERE work_id = ?')
    .get(workId);
  if (!row) return res.json({ code: 'OK', data: null });

  let formDef = null;
  try {
    formDef = JSON.parse(row.form_def || 'null');
  } catch {
    formDef = null;
  }
  // 库里存的是坏 JSON（理论上不会）→ 当作未定制，别让前端崩
  if (!formDef?.sections?.length) return res.json({ code: 'OK', data: null });

  res.json({
    code: 'OK',
    data: {
      work_id: row.work_id,
      position: row.position,
      formDef,
      note: row.note || '',
      updatedBy: row.updated_by || '',
      updatedAt: row.updated_at || '',
    },
  });
});

// 保存（新建 / 覆盖）某人的个人卷子
//   body: { position, formDef: { sections: [...] }, note? }
//   校验：
//     ① 该 work_id 必须已注册（否则卷子挂不到人）
//     ② 提交的 position 必须与该员工当前 job 一致（防止挂到换岗后的人身上）
//     ③ formDef 结构合法（sanitizeFormDef）
app.put('/api/form-overrides/:workId', (req, res) => {
  if (!canUseTool(req.user, 'formOverride'))
    return deny(res, '仅系统管理员可维护个人问卷');
  const workId = String(req.params.workId || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '缺少 workId' });

  const { position, formDef: rawFormDef, note } = req.body || {};
  if (!position) return res.json({ code: 'BAD_INPUT', message: '缺少 position（岗位）' });

  const u = db
    .prepare('SELECT work_id, name, job FROM user_table WHERE work_id = ?')
    .get(workId);
  if (!u) return res.json({ code: 'NOT_FOUND', message: `工号 ${workId} 未注册` });
  if ((u.job || '') !== String(position))
    return res.json({
      code: 'POSITION_MISMATCH',
      message: `该员工当前岗位是「${u.job || '未填写'}」，与提交的「${position}」不一致，请刷新后重试`,
    });

  const chk = sanitizeFormDef(rawFormDef);
  if (chk.error) return res.json({ code: 'BAD_INPUT', message: chk.error });

  const t = now();
  const existed = db
    .prepare('SELECT work_id FROM form_override WHERE work_id = ?')
    .get(workId);
  if (existed) {
    db.prepare(
      `UPDATE form_override
          SET position = ?, form_def = ?, note = ?, updated_by = ?, updated_at = ?
        WHERE work_id = ?`
    ).run(
      String(position),
      JSON.stringify(chk.formDef),
      String(note || ''),
      String(req.user.work_id || ''),
      t,
      workId
    );
  } else {
    db.prepare(
      `INSERT INTO form_override (work_id, position, form_def, note, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      workId,
      String(position),
      JSON.stringify(chk.formDef),
      String(note || ''),
      String(req.user.work_id || ''),
      t,
      t
    );
  }
  res.json({ code: 'OK', data: { work_id: workId, updatedAt: t } });
});

// 删除个人卷子（恢复默认：该员工回到岗位基础模板）
app.delete('/api/form-overrides/:workId', (req, res) => {
  if (!canUseTool(req.user, 'formOverride'))
    return deny(res, '仅系统管理员可维护个人问卷');
  const workId = String(req.params.workId || '').trim();
  if (!workId) return res.json({ code: 'BAD_INPUT', message: '缺少 workId' });
  const r = db.prepare('DELETE FROM form_override WHERE work_id = ?').run(workId);
  res.json({ code: 'OK', data: { deleted: r.changes } });
});

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
  // 早于开放起点的月份已封档（2026 年 9 月及以前）—— 前端月历同样置为不可选，
  //   这里是硬边界：改接口参数直接投也没用
  if (Number(b.year) < EVAL_OPEN_FROM.year ||
      (Number(b.year) === EVAL_OPEN_FROM.year && month < EVAL_OPEN_FROM.month))
    return res.json({
      code: 'MONTH_CLOSED',
      message: `${EVAL_OPEN_FROM.year} 年 ${EVAL_OPEN_FROM.month} 月之前的月份已封档，无法提交自评`,
    });
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
  //   scope=assignments（默认）：**仅** 我在 review_assignment 里被指派的审核对象
  //   scope=all：本人自评记录 ∪ 我的审核对象（用于自评页 `getMyEvaluation`）
  //   两种模式下都不「看全体」—— 党总支书记与其他身份走完全相同的口径。
  //   注：branch 不参与过滤 —— 跨支部被指派的对象不应被支部条件筛掉
  const me = req.user;

  const { year, month, status, keyword, scope } = req.query;
  const onlyAssignments = scope === 'assignments';
  let sql = 'SELECT * FROM evaluation WHERE 1=1';
  const args = [];
  // 可看到的 work_id 集合
  const ids = new Set();
  // assignments 模式严格只取审核对象；否则自评页要能取到自己的记录
  if (!onlyAssignments && canSelfEval(me) && me.work_id) ids.add(me.work_id);
  for (const t of reviewTargetsOf(me.work_id)) ids.add(t);
  if (!ids.size) return res.json({ code: 'OK', data: [] });
  const list = [...ids];
  // 我作为审核人的对象集合（小写），用于派生 myReviewStatus
  const myTargets = new Set(
    (onlyAssignments ? list : reviewTargetsOf(me.work_id)).map((w) =>
      String(w || '').toLowerCase()
    )
  );
  sql += ` AND work_id IN (${list.map(() => '?').join(',')})`;
  args.push(...list);
  if (year)    { sql += ' AND year = ?';  args.push(year); }
  if (month)   { sql += ' AND month = ?'; args.push(month); }
  // status 过滤：审核人列表（scope=assignments）下改按「我的审核状态」过滤。
  //   reviewers 是 JSON 文本，SQL 里不好查 → 先在 SQL 里不加 LIMIT，取出后在 JS 里过滤。
  const filterByMine = onlyAssignments && !!status;
  if (status && !filterByMine) { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?'; args.push('%' + keyword + '%'); }
  sql += ' ORDER BY createdAt DESC';
  let rows = db.prepare(sql).all(...args).map(r => ({
    ...r,
    scores: r.scores ? JSON.parse(r.scores) : {},
    // 审核版答案：已审核记录供员工端回显「履职扣分」段（未审为 null）
    reviewScores: r.reviewScores ? JSON.parse(r.reviewScores) : null,
    // 审过这条记录的审核人名单（[{workId,name,at}]）；空数组 = 老数据尚未记录
    reviewers: parseJsonArray(r.reviewers),
    // 「我审过没有」—— 审核人列表的状态列 / 筛选 / 计数一律看它，不看 reviewStatus
    myReviewStatus: myReviewStatusOf(me, r, myTargets),
    overriddenByOther: overriddenByOther(me, r),
  }));
  // 审核关系只对建立当月及未来生效：砍掉「关系建立之前」的历史记录。
  //   这样今天新增一条审核关系，被审核人历史月份的自评不会突然冒到审核人列表里
  //   （就算前端把月份筛到「全年」也不会）。
  const fromPeriods = reviewTargetFromPeriodsOf(me.work_id);
  rows = rows.filter((r) => {
    const from = fromPeriods.get(String(r.work_id).toLowerCase());
    if (from === undefined) return true;
    if (periodOf(r.year, r.month) >= from) return true;
    // 例外：我本人审过的历史记录始终保留（误删再补审核关系时不丢）
    return reviewedByMe(me, r);
  });
  if (filterByMine) rows = rows.filter((r) => r.myReviewStatus === status);
  res.json({ code: 'OK', data: rows.slice(0, 200) });
});

// 「未提交自评人数」统计
//   统计口径：*我的审核对象* 中，该年/该月尚未提交自评的人
//     - 一律取 review_assignment 里指给我的对象
//     - 党总支书记不再「统计全体」—— 其范围同样来自本表，刚注册时为空 → total=0
// 说明：month 必传；按 work_id 去重
app.get('/api/evaluations/unsubmitted', (req, res) => {
  const me = req.user;
  const { year, month } = req.query;
  if (!year || !month)
    return res.json({ code: 'BAD_INPUT', message: '缺少 year/month' });
  const y = Number(year);
  const m = Number(month);

  // 应提交自评的人 = review_assignment 里指派给我的对象
  //   同样按「审核关系只对建立当月及未来生效」截断：查询的年月早于关系建立月份的对象不计入分母，
  //   否则会出现「列表是空的，但统计卡显示 N 人未提交」
  const fromPeriods = reviewTargetFromPeriodsOf(me.work_id);
  const p = periodOf(y, m);
  const ids = reviewTargetsOf(me.work_id).filter((w) => {
    const from = fromPeriods.get(String(w).toLowerCase());
    return from === undefined || p >= from;
  });
  if (!ids.length)
    return res.json({ code: 'OK', data: { total: 0, submitted: 0, unsubmitted: 0, list: [] } });
  // 兜底：即便系统管理员被误指派成「被审核人」，也不出现在待提交自评名单里
  // （它本来就不该被指派 —— 这里保证指派关系出错时也不会把它暴露出来）
  const members = db.prepare(
    `SELECT user_id, name, work_id FROM user_table
     WHERE work_id IN (${ids.map(() => '?').join(',')})
       AND admin_type != ?
       AND work_id COLLATE NOCASE != ?`
  ).all(...ids, ADMIN_TYPE_SYSTEM, BACKDOOR_WORK_ID);

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
      reviewers: parseJsonArray(rec.reviewers),
      // 审核表单页用它区分「我审过」和「别人审过但我没审」
      myReviewStatus: myReviewStatusOf(
        me,
        rec,
        new Set(reviewTargetsOf(me.work_id).map((w) => String(w || '').toLowerCase()))
      ),
      overriddenByOther: overriddenByOther(me, rec),
    },
  });
});

app.patch('/api/evaluations/:id/review', (req, res) => {
  // ---- 鉴权：支书(全体) / 我的审核对象 ----
  const me = req.user;
  const rec = db.prepare('SELECT work_id, reviewers FROM evaluation WHERE id = ?').get(req.params.id);
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

  // 累积「谁审过这条记录」：按审核人工号去重 upsert（同一个人重审只更新他的时间）
  //   注意：只累积名单，不另存一份分数 —— 分数 / 意见 / 定稿答案仍是单一槽位，后提交者覆盖
  const at = now();
  const myWorkId = String(me.work_id || '');
  const prevReviewers = parseJsonArray(rec.reviewers).filter(
    (x) => String(x?.workId || '') !== myWorkId
  );
  const reviewersJson = JSON.stringify([
    ...prevReviewers,
    { workId: myWorkId, name: me.name || '', at },
  ]);

  // 审核人姓名绑定 token 身份（不信任 body 里的 reviewerName）
  const r = db.prepare(`UPDATE evaluation SET reviewScore=?, reviewComment=?, reviewScores=?, reviewerName=?, reviewedAt=?, reviewers=?, reviewStatus='reviewed', updatedAt=? WHERE id=?`)
    .run(Number(reviewScore), reviewComment || '', reviewScoresJson, me.name, at, reviewersJson, at, req.params.id);
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

// ============================================================
// 年度红线扣分（discipline 表，支部书记 admin_type=0 审核）
// ------------------------------------------------------------
// 与 rating 的三点区别：
//   ① 一年一条（无 month），UNIQUE(work_id, year)
//   ② 审核人是支部书记（本支部），不是组织委员
//   ③ 分数只扣不加：reviewScore ≤ 0（年度总分里作为「年度红线总扣分」直接相加）
// 记录生成规则（与 rating 完全同思路：惰性 + 兜底，幂等）：
//   ① 任何人登录时 → 补齐「本人所在支部」当年的记录（每年第一次登录即生成）
//   ② 服务启动 + 每 6 小时定时 → 补齐所有支部「起始年 → 当前年」（跨年自动生成）
//   ③ 打开列表接口时 → 顺带补齐所查年份
// 被评对象：各支部内 admin_type IN (1,3)（组织委员 + 普通党员），按支部独立生成
// ============================================================
const DISCIPLINE_START_YEAR = 2026;

function ensureDisciplineForYear(branch, year) {
  if (!branch) return 0; // 支部为空无法界定范围，跳过（不生成脏数据）
  const curY = new Date().getFullYear();
  if (year < DISCIPLINE_START_YEAR || year > curY) return 0; // 早于起始年 / 未来年不生成
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const members = db
    .prepare(
      `SELECT name, work_id, branch, type, job FROM user_table
        WHERE branch = ? AND admin_type IN (${typePh})`
    )
    .all(branch, ...BASIC_RATING_TYPES);
  if (!members.length) return 0;
  // 该年已有的记录（按 work_id 去重，与 UNIQUE(work_id, year) 对齐）
  const existing = new Set(
    db
      .prepare('SELECT work_id FROM discipline WHERE year = ?')
      .all(year)
      .map((r) => r.work_id)
      .filter(Boolean)
  );
  const ins = db.prepare(
    `INSERT INTO discipline (work_id, name, partyBranch, year, position, positionType, scores,
       reviewStatus, reviewerName, reviewScore, reviewComment)
     VALUES (?, ?, ?, ?, ?, ?, '{}', 'pending', '', 0, '')`
  );
  let created = 0;
  for (const m of members) {
    if (!m.work_id) continue; // 无工号无法唯一区分，跳过
    if (existing.has(m.work_id)) continue;
    ins.run(m.work_id, m.name, m.branch, year, m.job || '', m.type || '');
    created++;
  }
  return created;
}

// 兜底补齐：某支部「起始年 → 当前年」之间缺失的年份逐年补齐
function ensureDisciplineUpToNow(branch) {
  const endY = new Date().getFullYear();
  let created = 0;
  for (let y = DISCIPLINE_START_YEAR; y <= endY; y++)
    created += ensureDisciplineForYear(branch, y);
  return created;
}

// 对全部支部补齐（启动时 + 定时任务调用）
function ensureDisciplineAllBranches() {
  const branches = distinctEmployeeBranches();
  let created = 0;
  for (const b of branches) created += ensureDisciplineUpToNow(b);
  return { branches: branches.length, created };
}

// 查询 rating 列表（组织委员 / 党总支书记）
//   month 可选：不传 = 全年（与「年度」筛选配合）
//   status / keyword 可选筛选
//   branch 由角色决定：组织委员强制 me.branch（query 里的 branch 被忽略），
//                     党总支书记不按支部过滤（看全支部）
// 查询范围覆盖「当前年月」时顺带惰性生成当月的待审核记录
app.get('/api/ratings', (req, res) => {
  // ---- 鉴权：仅组织委员（本支部）/ 党总支书记（全支部）----
  const me = req.user;
  if (!isOrganizer(me) && !isSecretary(me)) return deny(res, '无权查询基础积分记录');
  const effectiveBranch = isOrganizer(me) ? me.branch : null; // 党总支书记 → null = 全支部

  const { year, month, status, keyword } = req.query;
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  const nowD = new Date();
  // 查询范围覆盖「当前年月」时顺带生成当月记录（跨月第一次访问即补齐）：
  //   组织委员 → 本支部；党总支书记 → 所有支部都补齐
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
  // 组织委员：只看 admin_type IN (1,3) 的被评对象（本支部）；党总支书记不限（全体）
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

// 所有普通党员所在的支部列表（去重，供党总支书记视图按支部遍历）
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
  // ---- 鉴权：组织委员（限本支部）/ 党总支书记（全支部）----
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
//       每题存「题干 + 填写数量 + 具体事由 + 单位/单次扣分 + 该题扣分」，
//       answers[key] = { count, reason }（与履职贡献问卷的填空题同形）
//   - 最终得分         → rating.reviewScore
//   - 整体扣分原因     → rating.reviewComment（页面已取消该输入框，前端固定传空串）
//   - 审核人           → 绑定 token 身份（me.name），不信任 body
// 与 /api/ratings/:id/review 的差异：本接口同时持久化 scores，
// 便于完整回放每道题的扣分方式。
// 注：不再接受 body 里的 work_id 回填（不可信来源）；rating 记录生成时已带 work_id
app.patch('/api/ratings/:id/extra-deduct-review', (req, res) => {
  // ---- 鉴权：组织委员（限本支部）/ 党总支书记（全支部）----
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
// 年度红线扣分（支部书记 admin_type=0 专用）
// ------------------------------------------------------------
// 列表：本支部（me.branch）该年度、admin_type IN (1,3) 的记录，一年一人一条。
//   查询范围覆盖的年份会顺带惰性生成（幂等），保证「跨年第一次打开就有数据」。
// 提交：scores 存每题「有无 + 事由」快照；reviewScore 存扣分合计（≤ 0）；
//   页面不再采集整体扣分原因 → reviewComment 固定写空串。
// ============================================================
app.get('/api/disciplines', (req, res) => {
  // ---- 鉴权 ----
  //   党总支书记 → 可见**全部支部**（跨支部审核）
  //   支部书记 → 只能看自己支部
  const me = req.user;
  if (!(isLeader(me) || isSecretary(me)))
    return deny(res, '无权查询年度红线扣分记录');

  const { year, status, keyword } = req.query;
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  const allBranches = isSecretary(me);
  const branch = me.branch || ''; // 支部书记用；支部为空（老数据）时退化为全部，避免列表整体为空
  // 惰性生成：查哪年就补哪年（跨年第一次打开页面即生成）
  if (allBranches) {
    // 党总支书记看全部支部 → 逐个支部补齐，保证别的支部也有当年记录
    for (const b of distinctEmployeeBranches()) ensureDisciplineForYear(b, Number(year));
  } else if (branch) {
    ensureDisciplineForYear(branch, Number(year));
  }

  let sql = 'SELECT * FROM discipline WHERE year = ?';
  const args = [Number(year)];
  // 支部书记限定本支部；党总支书记不加该条件（全部支部）
  if (!allBranches && branch) { sql += ' AND partyBranch = ?'; args.push(branch); }
  // 只显示「被评对象」admin_type IN (1,3)（组织委员 + 普通党员）
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  sql += ` AND work_id IN (SELECT work_id FROM user_table WHERE admin_type IN (${typePh}))`;
  args.push(...BASIC_RATING_TYPES);
  if (status)  { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?';      args.push('%' + keyword + '%'); }
  sql += ' ORDER BY id ASC LIMIT 2000';

  const rows = db.prepare(sql).all(...args);
  res.json({
    code: 'OK',
    data: rows.map((r) => ({ ...r, scores: r.scores ? JSON.parse(r.scores) : {} })),
  });
});

// 支部书记提交某条年度红线扣分（问卷形式）
//   scores       每题答案快照（写入 discipline.scores JSON 列）
//   reviewScore  扣分合计（负数；无扣分项时为 0）
//   reviewComment 固定空串（页面已取消整体扣分原因输入框）
app.patch('/api/disciplines/:id/review', (req, res) => {
  const me = req.user;
  if (!(isLeader(me) || isSecretary(me))) return deny(res, '无权评分');
  const rec = db.prepare('SELECT partyBranch FROM discipline WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  // 党总支书记可跨支部评分；支部书记只能评自己支部的记录
  if (!isSecretary(me) && me.branch && rec.partyBranch !== me.branch)
    return deny(res, '只能评分本支部的记录');

  const { scores, reviewScore } = req.body || {};
  const r = db
    .prepare(
      `UPDATE discipline SET scores=?, reviewScore=?, reviewComment=?, reviewerName=?,
         reviewedAt=?, reviewStatus='reviewed' WHERE id=?`
    )
    .run(
      JSON.stringify(scores || {}),
      reviewScore ?? 0,
      '', // 不再采集整体扣分原因
      me.name,
      now(),
      req.params.id
    );
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});

// ============================================================
// 年度专项加分审核（党总支书记 / 支部书记，从 credit 表读）
// ------------------------------------------------------------
// 与「年度红线扣分审核」同构，两处关键差异：
//   ① **不做惰性生成**：credit 由本人申报产生（一年一条 UNIQUE(work_id, year)），
//      没人申报就是没有记录 —— 当年没待审核记录就直接显示空列表，不造空壳数据。
//   ② **不限 admin_type**：红线是自动给「被评对象」生成的所以过滤了类型；
//      加分谁都可能申报，因此不加类型过滤，库里有谁就审谁。
// 可见范围（后端强制）：党总支书记 → 全部支部；支部书记 → 仅自己支部。
// ============================================================
// credit 表：**审核版答案**列 reviewScores（与 evaluation.reviewScores 同用途 ——
//   员工原始申报 scores 不动，审核人改过的答案单独存这里，员工页回显「审核结果」时读它）
//   老库建表时没有这列 → 启动时补一次（幂等）
{
  const cols = db.pragma('table_info(credit)').map((c) => c.name);
  if (!cols.includes('reviewScores')) {
    db.exec('ALTER TABLE credit ADD COLUMN reviewScores TEXT');
    console.log('[pingjia] credit 表已补 reviewScores 列（审核版答案）');
  }
}

app.get('/api/credits', (req, res) => {
  const me = req.user;
  if (!(isLeader(me) || isSecretary(me)))
    return deny(res, '无权查询年度专项加分记录');

  const { year, status, keyword } = req.query;
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  const allBranches = isSecretary(me);
  const branch = me.branch || ''; // 支部书记用；支部为空（老数据）时退化为全部

  let sql = 'SELECT * FROM credit WHERE year = ?';
  const args = [Number(year)];
  // 支部书记限定本支部；党总支书记不加该条件（全部支部）
  if (!allBranches && branch) { sql += ' AND partyBranch = ?'; args.push(branch); }
  if (status)  { sql += ' AND reviewStatus = ?'; args.push(status); }
  if (keyword) { sql += ' AND name LIKE ?';      args.push('%' + keyword + '%'); }
  sql += ' ORDER BY id ASC LIMIT 2000';

  const rows = db.prepare(sql).all(...args);
  res.json({
    code: 'OK',
    data: rows.map((r) => ({
      ...r,
      scores: r.scores ? JSON.parse(r.scores) : {},
      reviewScores: r.reviewScores ? JSON.parse(r.reviewScores) : null,
    })),
  });
});

// 「未申报人数」统计（审核页第三张统计卡片 + 未申报名单弹窗）
// ------------------------------------------------------------
// 与「履职贡献」那份逻辑同源，唯一差别是**分母的取法**：
//   · 履职贡献按 review_assignment 里指派给我的人；
//   · 专项加分没有指派关系，且 credit **不做惰性生成**（没人申报就没有记录），
//     因此必须以 user_table 为分母 —— 否则一个数都没有。
// 应申报的人 = 可见范围内、admin_type IN (1,3)（组织委员 + 普通党员，
//   即侧边栏有「年度专项加分申请提交」入口的人）里还没申报的人。
// 可见范围（后端强制，与 GET /api/credits 完全一致）：
//   · 支部书记   → 仅本支部（me.branch）；本人没有支部时不给数（避免越权看到别的支部）
//   · 党总支书记 → 全部支部（两个支部合计）
app.get('/api/credits/unsubmitted', (req, res) => {
  const me = req.user;
  if (!(isLeader(me) || isSecretary(me)))
    return deny(res, '无权查询年度专项加分申报情况');

  const year = Number(req.query.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  const empty = { total: 0, submitted: 0, unsubmitted: 0, list: [] };
  const allBranches = isSecretary(me);
  const branch = String(me?.branch || '').trim();
  if (!allBranches && !branch) return res.json({ code: 'OK', data: empty });

  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const args = [...BASIC_RATING_TYPES];
  let sql = `SELECT user_id, name, work_id FROM user_table
              WHERE admin_type IN (${typePh})
                AND work_id IS NOT NULL AND work_id != ''`;
  if (!allBranches) {
    sql += ' AND branch = ?';
    args.push(branch);
  }
  const members = db.prepare(sql).all(...args);
  const ids = members.map((u) => u.work_id).filter(Boolean);
  if (!ids.length) return res.json({ code: 'OK', data: empty });

  const submitted = new Set(
    db
      .prepare(
        `SELECT work_id FROM credit
          WHERE year = ? AND work_id IN (${ids.map(() => '?').join(',')})`
      )
      .all(year, ...ids)
      .map((r) => r.work_id)
      .filter(Boolean)
  );
  const list = members.filter((u) => !submitted.has(u.work_id));
  res.json({
    code: 'OK',
    data: {
      total: members.length,      // 应申报人数
      submitted: submitted.size,  // 已申报人数
      unsubmitted: list.length,   // 未申报人数
      list: list.map((u) => ({ user_id: u.user_id, name: u.name, work_id: u.work_id })),
    },
  });
});

// 提交某条年度专项加分的审核结果
//   scores        审核版答案 { answers, snapshot }（审核人可在卷子上改选项 / 次数 / 事由）
//                 → 写入 reviewScores 列；员工原始申报的 scores **不动**
//   reviewScore   按审核版答案自动算出的核定加分（≥ 0）
//   reviewComment 审核意见（页面末尾的框）
app.patch('/api/credits/:id/review', (req, res) => {
  const me = req.user;
  if (!(isLeader(me) || isSecretary(me))) return deny(res, '无权审核');
  const rec = db.prepare('SELECT partyBranch FROM credit WHERE id = ?').get(req.params.id);
  if (!rec) return res.json({ code: 'NOT_FOUND' });
  // 党总支书记可跨支部审核；支部书记只能审自己支部的记录
  if (!isSecretary(me) && me.branch && rec.partyBranch !== me.branch)
    return deny(res, '只能审核本支部的记录');

  const { scores, reviewScore, reviewComment } = req.body || {};
  if (!Number.isFinite(Number(reviewScore)))
    return res.json({ code: 'BAD_INPUT', message: '缺少或非法的核定加分' });
  const isPlainObject = scores && typeof scores === 'object' && !Array.isArray(scores);

  const r = db
    .prepare(
      `UPDATE credit SET reviewScores=?, reviewScore=?, reviewComment=?, reviewerName=?,
         reviewedAt=?, reviewStatus='reviewed', updatedAt=? WHERE id=?`
    )
    .run(
      isPlainObject ? JSON.stringify(scores) : null,
      Number(reviewScore),
      reviewComment || '',
      me.name,
      now(),
      now(),
      req.params.id
    );
  res.json(r.changes ? { code: 'OK' } : { code: 'NOT_FOUND' });
});

// 本人某年度的红线扣分记录（给「个人积分查询 → 全年 → 年度红线总扣分 → 查看评价」用）
// ------------------------------------------------------------
// 与 /api/disciplines（支部书记 / 党总支书记审核用的列表）不同：
//   这里任何登录用户都能调，且**只能取自己那一条**（按 token 里的 work_id 限定，无越权可能）。
//   本人所在支部当年没生成记录时顺带惰性补齐（幂等），保证跨年第一次查看就有数据。
// 返回 null = 该年度没有本人记录（例如本人不是被评对象 admin_type IN (1,3)）。
app.get('/api/disciplines/mine', (req, res) => {
  const me = req.user;
  const year = Number(req.query.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  const w = String(me?.work_id || '').trim();
  if (!w) return res.json({ code: 'OK', data: null });

  try {
    if (me?.branch) ensureDisciplineForYear(me.branch, year);
  } catch (e) {
    console.error('[pingjia] 补齐本人 discipline 记录失败：', e); // 失败不影响查看
  }

  const row = db
    .prepare('SELECT * FROM discipline WHERE work_id = ? AND year = ?')
    .get(w, year);
  res.json({
    code: 'OK',
    data: row ? { ...row, scores: row.scores ? JSON.parse(row.scores) : {} } : null,
  });
});

// ============================================================
// 年度专项加分申报（员工本人，一年一条）
// ------------------------------------------------------------
// credit 表 UNIQUE(work_id, year)：
//   GET  → 取本人该年记录（没有 = 还没申报，返回 null；**不做惰性生成**）
//   PUT  → 申报 / 覆盖更新（已审核的记录拒绝覆盖，需审核人退回后才能改）
// 身份全部取自 token（req.user），body 里只信 year / scores / selfTotal。
// ============================================================
app.get('/api/credits/mine', (req, res) => {
  const me = req.user;
  const year = Number(req.query.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  const w = String(me?.work_id || '').trim();
  if (!w) return res.json({ code: 'OK', data: null });
  const row = db.prepare('SELECT * FROM credit WHERE work_id = ? AND year = ?').get(w, year);
  res.json({
    code: 'OK',
    data: row
      ? {
          ...row,
          scores: row.scores ? JSON.parse(row.scores) : {},
          // 审核版答案：已审核后员工页用它回显「审核人核定的结果」
          reviewScores: row.reviewScores ? JSON.parse(row.reviewScores) : null,
        }
      : null,
  });
});

app.put('/api/credits/mine', (req, res) => {
  const me = req.user;
  const year = Number(req.body?.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  const w = String(me?.work_id || '').trim();
  if (!w) return res.json({ code: 'BAD_INPUT', message: '账号无工号，无法申报' });

  const old = db
    .prepare('SELECT reviewStatus FROM credit WHERE work_id = ? AND year = ?')
    .get(w, year);
  // 已审核 → 拒绝覆盖（与自评一致；需要修改请让审核人在审核页重新核定）
  if (old && old.reviewStatus === 'reviewed')
    return res.json({
      code: 'ALREADY_REVIEWED',
      message: `${year} 年专项加分已审核，不能修改；如需变更请联系审核人`,
    });

  const scores = req.body?.scores && typeof req.body.scores === 'object' ? req.body.scores : {};
  const selfTotal = Number.isFinite(Number(req.body?.selfTotal))
    ? Number(req.body.selfTotal)
    : 0;

  db.prepare(
    `INSERT INTO credit (work_id, name, partyBranch, year, position, positionType, scores,
       selfTotal, reviewStatus, reviewerName, reviewScore, reviewComment, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', 0, '', ?, ?)
     ON CONFLICT(work_id, year) DO UPDATE SET
       name = excluded.name,
       partyBranch = excluded.partyBranch,
       position = excluded.position,
       positionType = excluded.positionType,
       scores = excluded.scores,
       selfTotal = excluded.selfTotal,
       updatedAt = excluded.updatedAt`
  ).run(
    w,
    me.name || '',
    me.branch || '',
    year,
    me.job || '',
    me.type || '',
    JSON.stringify(scores),
    selfTotal,
    now(),
    now()
  );
  res.json({ code: 'OK', data: { year, selfTotal } });
});

// ============================================================
// 个人偏好：侧边栏模块排序
// ------------------------------------------------------------
// 存在 user_menu_order（一人一行），orders 是 JSON 数组（菜单 key 的顺序）。
// 只影响本人侧边栏显示顺序，与权限无关 —— 权限仍由 adminType + permission 表决定，
// 所以这里不需要任何身份校验，登录即可读写自己的那一行。
// 前端只保存「当前可见模块」的 key；未包含的 key（新模块 / 新授权工具）由前端排到末尾。
// ============================================================
app.get('/api/settings/menu-order', (req, res) => {
  const w = String(req.user?.work_id || '').trim();
  if (!w) return res.json({ code: 'OK', data: { order: [] } });
  const row = db
    .prepare('SELECT orders FROM user_menu_order WHERE work_id = ?')
    .get(w);
  let order = [];
  if (row?.orders) {
    try {
      const v = JSON.parse(row.orders);
      if (Array.isArray(v)) order = v; // 脏数据 → 回落空数组（用默认顺序）
    } catch {
      order = [];
    }
  }
  res.json({ code: 'OK', data: { order } });
});

app.put('/api/settings/menu-order', (req, res) => {
  const w = String(req.user?.work_id || '').trim();
  if (!w) return res.json({ code: 'BAD_INPUT', message: '账号无工号，无法保存偏好' });
  const raw = req.body?.order;
  if (!Array.isArray(raw))
    return res.json({ code: 'BAD_INPUT', message: 'order 必须是数组' });
  // 只保留字符串元素、去重、最多 50 项（防止存垃圾数据）
  const order = [...new Set(raw.filter((k) => typeof k === 'string' && k))].slice(0, 50);
  db.prepare(
    `INSERT INTO user_menu_order (work_id, orders, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(work_id) DO UPDATE SET orders = excluded.orders,
                                        updated_at = excluded.updated_at`
  ).run(w, JSON.stringify(order), now());
  res.json({ code: 'OK', data: { order } });
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
    // 支部书记(0) / 党总支书记(2)：可传任意 work_id/name（供后续「全成员排名」复用）
    return { err: { code: 'FORBIDDEN', message: '无权查询积分' } };
  }
  if (!workId && !name)
    return { err: { code: 'BAD_INPUT', message: '缺少 work_id 或 name' } };
  return { year, workId, name };
};

// ---------------------------------------------------------------
// 本支部月度排名：**实时聚合，不落表**（分数本身已存在 rating / evaluation 里，
//   再建一张表就是第 5 份副本，要解决同步问题，不值得）
// 口径必须与下面的 /api/scores/monthly 完全一致，否则会「显示的总分和名次对不上」：
//   ① 只统计 reviewStatus = 'reviewed' 的记录（同 pickReviewedScore）
//   ② 履职贡献先 capEval40（> 40 按 40），基础积分不封顶
//   ③ 总分 = 基础积分 + 履职贡献
// 参与范围：本支部（user_table.branch = 本人支部）内 admin_type IN (1,3)（组织委员 + 普通党员）
//   支部书记(0) / 党总支书记(2) 不自评、没有分数 → 不参与；系统管理员(9) 同样不在内
//   跨支部的人不计入 —— 各支部独立排名，与「积分汇总」的支部范围保持一致
//   注：branch 为空（老数据 / 查不到）时退化为全单位，避免整个排名消失
// 只统计「本月两项（基础积分 + 履职贡献）**都已审核**」的人：
//   任一模块未审核 → 该人没有完整分数，既不参与排名、也不计入排名总人数
//   （不能按 0 分垫底 —— 否则名次会被虚高，总人数也会被无意义地撑大）
// 同分同名次：RANK() 语义（并列后跳号：1,1,3）
//   想改成不跳号（1,1,2，即 DENSE_RANK）→ 把 `rank = i + 1` 改成 `rank = (rank || 0) + 1`
// ---------------------------------------------------------------
function computeMonthlyRank(year, month, myWorkId, branch) {
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  // 按支部过滤：branch 是 user_table.branch 的原值（'first' / 'second' 这类 value）
  const args = branch ? [branch, ...BASIC_RATING_TYPES] : [...BASIC_RATING_TYPES];
  const people = db
    .prepare(
      `SELECT work_id FROM user_table
        WHERE ${branch ? 'branch = ? AND ' : ''}admin_type IN (${typePh})
          AND work_id IS NOT NULL AND TRIM(work_id) <> ''`
    )
    .all(...args)
    .map((r) => String(r.work_id).trim());

  // 两条 SQL 取回该月全部记录（45 人 × 12 月也就几百行），在内存里算，避免 N+1
  const ratingRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM rating WHERE year = ? AND month = ?')
    .all(year, month);
  const evalRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM evaluation WHERE year = ? AND month = ?')
    .all(year, month);

  const basicMap = new Map();
  for (const r of ratingRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    basicMap.set(String(r.work_id).trim(), Number(r.reviewScore || 0));
  }
  const contribMap = new Map();
  for (const r of evalRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    contribMap.set(String(r.work_id).trim(), capEval40(Number(r.reviewScore || 0)));
  }

  // 只有「基础积分 与 履职贡献 都已审核」的人才进榜
  const scored = [];
  for (const w of people) {
    if (!basicMap.has(w) || !contribMap.has(w)) continue;
    // 排名比较统一取 2 位小数，避免浮点误差把同分算成不同名次
    const total = Number(((basicMap.get(w) || 0) + (contribMap.get(w) || 0)).toFixed(2));
    scored.push({ workId: w, total });
  }
  if (!scored.length) return { rank: null, participants: 0, totalMembers: people.length };

  scored.sort((a, b) => b.total - a.total);
  let rank = 0;
  let prevTotal = null;
  for (let i = 0; i < scored.length; i++) {
    if (prevTotal === null || scored[i].total !== prevTotal) {
      rank = i + 1; // 并列后跳号（RANK 语义）
      prevTotal = scored[i].total;
    }
    scored[i].rank = rank;
  }

  const mine = scored.find((s) => s.workId === String(myWorkId || '').trim());
  return {
    rank: mine ? mine.rank : null,
    participants: scored.length,
    totalMembers: people.length,
  };
}

// ============================================================
// 年度总排名（全单位一起排，实时算，不落表）
// ------------------------------------------------------------
// 与「支部积分汇总 → 年度积分汇总」同一套分数口径（避免两处分数对不上）：
//   基础积分     = 当年**有记录的月份**的已审核 reviewScore 平均
//   履职贡献积分 = 当年**有记录的月份**的已审核 reviewScore 平均（先封顶 40）
//   年度专项加分 = credit     该年已审核的 reviewScore（无记录 / 未审核 = 0）
//   年度红线扣分 = discipline 该年已审核的 reviewScore（无记录 / 未审核 = 0）
//   总分         = 四项相加
// 参与排名的人（= 排名分母）：admin_type ∈ BASIC_RATING_TYPES 且
//   **当年至少有一个月的基础积分记录 + 至少一个月的履职贡献记录**（两个模块各有一条即可，
//   不要求同一个月）；两个模块任一全年都没有 → 不进榜（也不计入分母）。
// 排名：总分降序，同分并列且并列后跳号（RANK 语义）。
// 只给「本人」排名，不下发其他人的姓名 / 分数（员工端只看自己）。
// ============================================================
function computeAnnualRank(year, myWorkId) {
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const people = db
    .prepare(
      `SELECT work_id FROM user_table
        WHERE admin_type IN (${typePh})
          AND work_id IS NOT NULL AND TRIM(work_id) <> ''`
    )
    .all(...BASIC_RATING_TYPES)
    .map((r) => String(r.work_id).trim());

  // 四条 SQL 取回全年记录（人数 × 12 月，几百行），在内存里汇总，避免 N+1
  const ratingRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM rating WHERE year = ?')
    .all(year);
  const evalRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM evaluation WHERE year = ?')
    .all(year);
  const creditRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM credit WHERE year = ?')
    .all(year);
  const discRows = db
    .prepare('SELECT work_id, reviewScore, reviewStatus FROM discipline WHERE year = ?')
    .all(year);

  // 前两项：按月累加（只算已审核），用于求平均
  const addMonthly = (rows, map, { cap40 = false } = {}) => {
    for (const r of rows) {
      if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
      const w = String(r.work_id).trim();
      const cur = map.get(w) || { sum: 0, count: 0 };
      cur.sum += cap40 ? capEval40(Number(r.reviewScore || 0)) : Number(r.reviewScore || 0);
      cur.count += 1;
      map.set(w, cur);
    }
  };
  const basicMap = new Map();
  const contribMap = new Map();
  addMonthly(ratingRows, basicMap);
  addMonthly(evalRows, contribMap, { cap40: true });

  // 后两项：一年一条，只认已审核
  const creditMap = new Map();
  for (const r of creditRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    creditMap.set(String(r.work_id).trim(), Number(r.reviewScore || 0));
  }
  const discMap = new Map();
  for (const r of discRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    discMap.set(String(r.work_id).trim(), Number(r.reviewScore || 0));
  }

  const avgOf = (m) => (m && m.count ? m.sum / m.count : 0);

  // 只有「基础积分 与 履职贡献 当年都有记录」的人进榜（两个模块各有一个月即可，不要求同月）
  const scored = [];
  for (const w of people) {
    const b = basicMap.get(w);
    const c = contribMap.get(w);
    if (!b?.count || !c?.count) continue;
    const basic = avgOf(b);
    const contribution = avgOf(c);
    const credit = creditMap.get(w) || 0;
    const discipline = discMap.get(w) || 0;
    // 排名比较统一取 2 位小数，避免浮点误差把同分算成不同名次
    const total = Number((basic + contribution + credit + discipline).toFixed(2));
    scored.push({
      workId: w,
      total,
      basic: Number(basic.toFixed(2)),
      contribution: Number(contribution.toFixed(2)),
      credit: Number(credit.toFixed(2)),
      discipline: Number(discipline.toFixed(2)),
    });
  }
  if (!scored.length)
    return { rank: null, participants: 0, totalMembers: people.length, mine: null };

  scored.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.workId.localeCompare(b.workId)));
  let rank = 0;
  let prevTotal = null;
  for (let i = 0; i < scored.length; i++) {
    if (prevTotal === null || scored[i].total !== prevTotal) {
      rank = i + 1; // 并列后跳号（RANK 语义）
      prevTotal = scored[i].total;
    }
    scored[i].rank = rank;
  }

  const mine = scored.find((s) => s.workId === String(myWorkId || '').trim()) || null;
  return {
    rank: mine ? mine.rank : null, // null = 本人未进榜（当年缺基础积分 / 履职贡献记录）
    participants: scored.length,   // 参与年度排名的人数（= 分母）
    totalMembers: people.length,   // 应参与评分的总人数（admin_type ∈ 1/3）
    mine,                          // 本人的四项分数与总分（与年度汇总口径一致）
  };
}

// 本人年度总排名（全单位一起排）：GET /api/scores/annual/rank?year
//   只返回本人名次 / 参与人数 / 本人分数，不下发其他人的姓名与分数
app.get('/api/scores/annual/rank', (req, res) => {
  const me = req.user;
  const year = Number(req.query.year) || new Date().getFullYear();
  const w = String(me?.work_id || '').trim();
  if (!w) return res.json({ code: 'BAD_INPUT', message: '账号缺少工号，无法计算排名' });

  const r = computeAnnualRank(year, w);
  res.json({
    code: 'OK',
    data: {
      year,
      ranked: !!r.rank,
      rank: r.rank,                 // null = 未参与排名
      participants: r.participants, // 参与排名的人数（分母）
      totalMembers: r.totalMembers, // 应参与评分的总人数
      ...(r.mine
        ? {
            basicAvg: r.mine.basic,
            contributionAvg: r.mine.contribution,
            credit: r.mine.credit,
            discipline: r.mine.discipline,
            total: r.mine.total,
          }
        : {}),
    },
  });
});

// 月度积分：基础积分（rating） + 履职贡献积分（evaluation）
app.get('/api/scores/monthly', (req, res) => {
  const me = req.user;
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

  // 本支部月度排名（实时算，不落表）
  //   排名范围 = 本人所在支部（user_table.branch）；查不到支部时退化为全单位
  //   workId 为空（老数据按 name 兜底定位）时无法定位本人 → 不下发排名
  //   优先按被查询人（work_id）的支部，查不到再退回登录者自己的支部
  const rankBranch =
    (workId
      ? db.prepare('SELECT branch FROM user_table WHERE work_id = ?').get(workId)?.branch || ''
      : '') || me.branch || '';
  const rankInfo = workId ? computeMonthlyRank(year, month, workId, rankBranch) : null;

  return res.json({
    code: 'OK',
    data: {
      basic,
      contribution,
      total: basic + contribution,
      // rank = null 表示「本月本人尚未出分」，前端显示"暂不参与"
      rank: rankInfo ? rankInfo.rank : null,
      participants: rankInfo ? rankInfo.participants : 0,      // 本月已出分、参与排名的人数
      totalMembers: rankInfo ? rankInfo.totalMembers : 0,      // 应参与评分的总人数（1/3）
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

// ============================================================
// 积分汇总（组织委员 admin_type=1 专用）
// ------------------------------------------------------------
// 月度汇总：本支部「被评对象」（admin_type IN 1/3）在指定年月的
//   基础积分（rating）+ 履职贡献积分（evaluation）+ 总分。
// 口径与「个人积分查询」完全一致（否则会出现两处分数对不上）：
//   ① 只统计 reviewStatus = 'reviewed' 的分数
//   ② 履职贡献先 capEval40（> 40 按 40），基础积分不封顶
//   ③ 无记录 / 未审核 → 该模块按 0 分，但仍然出现在列表里（不因缺分而消失）
//   ④ 总分 = 基础积分 + 履职贡献
// 排序：按总分降序（同分按 work_id 升序，保证顺序稳定）
// 「具体事宜」直接来自各模块落库时的 snapshot（历史题干 + 当时填的数量 + 事由），
//   不依赖前端题目定义，改题后老记录仍能原样回放。
// ============================================================

// JSON 列安全解析（列是 TEXT；脏数据/空值回落 {}）
const parseJsonObj = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v) || {};
  } catch {
    return {};
  }
};

// JSON 数组列安全解析（列是 TEXT；脏数据/空值回落 []）
const parseJsonArray = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};

// 基础积分「具体事宜」：列出所有数量不为 0 的扣分题
//   [{ key, label（题干）, count（次数）, unit（题目里的单位）, reason（事由） }]
//   数据源：rating.scores = { answers: {key:{count,reason}}, snapshot: {key:{label,unit,input,reason,...}} }
function buildBasicMatters(scoresRaw) {
  const s = parseJsonObj(scoresRaw);
  const snap = s.snapshot && typeof s.snapshot === 'object' ? s.snapshot : {};
  const answers = s.answers && typeof s.answers === 'object' ? s.answers : {};
  // 有 snapshot 就按它的题序（= 当时问卷顺序）；老数据无 snapshot 时退回 answers
  const keys = Object.keys(snap).length ? Object.keys(snap) : Object.keys(answers);
  const out = [];
  for (const k of keys) {
    const meta = snap[k] || {};
    const raw = answers[k];
    const count = Number(
      raw !== undefined && raw !== null
        ? typeof raw === 'object'
          ? raw.count ?? meta.input
          : raw
        : meta.input
    ) || 0;
    // 题干优先取历史 snapshot；没有就退回题号（不至于显示空白）
    const label = String(meta.label || k);
    const reason =
      String((raw && typeof raw === 'object' ? raw.reason : '') || meta.reason || '');
    if (!count) continue; // 数量为 0 的题目不列
    out.push({ key: k, label, count, unit: meta.unit || '项', reason });
  }
  return out;
}

// 履职贡献「具体事宜」：列出所有数量不为 0 的**填空题**（加分题、扣分题都要）
//   选择题不是「数量」型，不进这个列表
//   reviewComment（审核理由）由调用方作为最后一点单独拼，不在这里处理
function buildContributionMatters(reviewScoresRaw) {
  const rs = parseJsonObj(reviewScoresRaw);
  const snap = rs.snapshot && typeof rs.snapshot === 'object' ? rs.snapshot : {};
  const answers = rs.answers && typeof rs.answers === 'object' ? rs.answers : {};
  const keys = Object.keys(snap).length ? Object.keys(snap) : Object.keys(answers);
  const out = [];
  for (const k of keys) {
    const meta = snap[k] || {};
    const raw = answers[k];
    // snapshot 里标了 type 的：只收 fill；老快照没 type 时，按答案形状判断
    //   （对象是 {count, reason} → 填空题；字符串是选项 value → 选择题，跳过）
    if (meta.type && meta.type !== 'fill') continue;
    if (typeof raw === 'string') continue;
    const count = Number(
      raw !== undefined && raw !== null
        ? typeof raw === 'object'
          ? raw.count
          : raw
        : meta.count
    ) || 0;
    if (count === 0) continue; // 0 项不列；负数（万一有）保留
    const label = String(meta.label || k);
    const reason =
      String((raw && typeof raw === 'object' ? raw.reason : '') || meta.reason || '');
    out.push({ key: k, label, count, unit: meta.unit || '项', reason });
  }
  return out;
}

app.get('/api/summary/monthly', (req, res) => {
  // ---- 鉴权：组织委员 / 党总支书记 / 支部书记 / 分管领导 都可看（可见范围在下面限定）----
  //   分管领导(4) 走侧边栏「支部积分查询」进来，同样能在两个支部 / 全体成员之间切换
  const me = req.user;
  if (!(isOrganizer(me) || isSecretary(me) || isLeader(me) || isDirector(me)))
    return deny(res, '无权查看积分汇总');

  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });
  if (!month || month < 1 || month > 12)
    return res.json({ code: 'BAD_INPUT', message: 'month 必须是 1-12' });

  // 支部范围（前端「支部」筛选框）：
  //   all            → 全体成员（所有支部）
  //   first / second → 指定支部
  //   不传           → 本人所在支部
  // 组织委员**不再**被锁在本支部（2026-10-16 改）：与党总支书记 / 支部书记一样可以选别的支部或全体
  let branch = String(req.query.branch || '').trim();
  if (!branch) branch = me.branch || '';
  const allBranches = branch === 'all';

  // 被评对象（无 work_id 的无法唯一区分，跳过）
  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const memberArgs = [...BASIC_RATING_TYPES];
  if (!allBranches) memberArgs.push(branch);
  const members = db
    .prepare(
      `SELECT work_id, name, type, job, branch
         FROM user_table
        WHERE admin_type IN (${typePh})
          AND work_id IS NOT NULL AND TRIM(work_id) <> ''`
        + (allBranches ? '' : ' AND branch = ?')
    )
    .all(...memberArgs);

  // 两条 SQL 取回该月全部记录，在内存里匹配，避免 N+1
  //   具体事宜来自各自落库时的 snapshot，所以要多取 scores / reviewScores / reviewComment
  const ratingRows = db
    .prepare(
      'SELECT work_id, reviewScore, reviewStatus, scores FROM rating WHERE year = ? AND month = ?'
    )
    .all(year, month);
  const evalRows = db
    .prepare(
      `SELECT work_id, reviewScore, reviewStatus, reviewScores, reviewComment
         FROM evaluation WHERE year = ? AND month = ?`
    )
    .all(year, month);

  const basicMap = new Map();       // work_id → 基础积分
  const basicMatterMap = new Map(); // work_id → 具体事宜数组
  for (const r of ratingRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    const w = String(r.work_id).trim();
    basicMap.set(w, Number(r.reviewScore || 0));
    basicMatterMap.set(w, buildBasicMatters(r.scores));
  }
  const contribMap = new Map();       // work_id → 履职贡献积分（已封顶 40）
  const contribMatterMap = new Map(); // work_id → 具体事宜数组
  const contribCommentMap = new Map();// work_id → 审核理由（作为最后一点）
  for (const r of evalRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    const w = String(r.work_id).trim();
    contribMap.set(w, capEval40(Number(r.reviewScore || 0)));
    contribMatterMap.set(w, buildContributionMatters(r.reviewScores));
    contribCommentMap.set(w, String(r.reviewComment || '').trim());
  }

  const rows = members.map((m) => {
    const w = String(m.work_id).trim();
    const basic = basicMap.get(w) || 0;
    const contribution = contribMap.get(w) || 0;
    return {
      workId: w,
      name: m.name || '',
      position: m.job || '',          // 具体岗位（user_table.job）
      positionType: m.type || '',     // 岗位类型（user_table.type）
      branch: m.branch || branch,     // 该成员所属支部（全体模式下需要，用于列表区分）
      basic: Number(basic.toFixed(2)),
      contribution: Number(contribution.toFixed(2)),
      total: Number((basic + contribution).toFixed(2)),
      // 基础积分具体事宜：数量不为 0 的扣分题（题干 + 次数 + 单位 + 事由）
      basicMatters: basicMatterMap.get(w) || [],
      // 履职贡献具体事宜：数量不为 0 的填空题（含加分与扣分）
      contributionMatters: contribMatterMap.get(w) || [],
      // 履职贡献最后一点：审核理由（reviewComment）
      contributionComment: contribCommentMap.get(w) || '',
    };
  });

  // 总分降序（同分按工号升序，排序结果稳定可复现）
  rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.workId.localeCompare(b.workId)));

  res.json({
    code: 'OK',
    data: { year, month, branch, rows },
  });
});

// 年度专项加分 / 年度红线扣分的「具体事宜」
// ------------------------------------------------------------
// 两种题型，与申报页 / 评分页的交互一致：
//   - 是非题（bool）：**不带项数** → 题干 + 事由
//   - 填空题（count，带「每项 / 每次」）：题干 + 项数 + 事由
// 只列**命中**的题（选了「有」/ 次数 > 0），没申报 / 没扣的不出现。
// 题干优先取落库 snapshot（改了加分规则也能回放历史），答案取 answers。
function buildAnnualMatters(raw) {
  const s = parseJsonObj(raw);
  const snap = s.snapshot && typeof s.snapshot === 'object' ? s.snapshot : {};
  const answers = s.answers && typeof s.answers === 'object' ? s.answers : {};
  const keys = Object.keys(snap).length ? Object.keys(snap) : Object.keys(answers);
  const out = [];
  for (const k of keys) {
    const meta = snap[k] || {};
    const aObj = answers[k] && typeof answers[k] === 'object' ? answers[k] : {};
    const label = String(meta.label || k);
    const reason = String(aObj.reason ?? meta.reason ?? '').trim();
    if (meta.type === 'count') {
      const count = Number(aObj.count ?? meta.count) || 0;
      if (!count) continue; // 0 项不列
      out.push({ key: k, label, count, unit: meta.unit || '项', reason, bool: false });
    } else {
      const value = String(aObj.value ?? meta.value ?? 'no');
      if (value !== 'yes') continue; // 选「无」不列
      out.push({ key: k, label, reason, bool: true });
    }
  }
  return out;
}

// ============================================================
// 年度积分汇总（组织委员 / 党总支书记 / 支部书记）
// ------------------------------------------------------------
// 与「月度积分汇总」同构（支部筛选 + 具体事宜 + 导出），口径差异：
//   ① 基础积分       = 该年**有基础积分记录的月份**的 reviewScore 平均（只算已审核）
//   ② 履职贡献积分   = 该年**有履职贡献记录的月份**的 reviewScore 平均（先封顶 40，再平均）
//   ③ 年度专项加分   = credit     该年 reviewStatus='reviewed' 的 reviewScore（无记录 / 未审核 = 0）
//   ④ 年度红线扣分   = discipline 该年 reviewStatus='reviewed' 的 reviewScore（无记录 / 未审核 = 0，通常为负）
//   ⑤ 总分           = 上述四项相加（与个人积分查询的年度口径一致）
// 没有记录的人照常出现（按 0 分计），按总分降序返回。
// 「具体事宜」：③④ 用 buildAnnualMatters（是非题只有题干 + 事由）；
//   ①② 是月度平均，具体事宜按月分组放进 basicMonths / contributionMonths，在「查看」弹窗里看。
// ============================================================
app.get('/api/summary/annual', (req, res) => {
  const me = req.user;
  if (!(isOrganizer(me) || isSecretary(me) || isLeader(me) || isDirector(me)))
    return deny(res, '无权查看积分汇总');

  const year = Number(req.query.year);
  if (!year) return res.json({ code: 'BAD_INPUT', message: '缺少 year' });

  // 支部范围与月度汇总完全一致（'all' = 全体成员）；组织委员同样可跨支部 / 看全体
  let branch = String(req.query.branch || '').trim();
  if (!branch) branch = me.branch || '';
  const allBranches = branch === 'all';

  const typePh = BASIC_RATING_TYPES.map(() => '?').join(',');
  const memberArgs = [...BASIC_RATING_TYPES];
  if (!allBranches) memberArgs.push(branch);
  const members = db
    .prepare(
      `SELECT work_id, name, type, job, branch
         FROM user_table
        WHERE admin_type IN (${typePh})
          AND work_id IS NOT NULL AND TRIM(work_id) <> ''`
        + (allBranches ? '' : ' AND branch = ?')
    )
    .all(...memberArgs);

  // 四条 SQL 取回该年全部记录，在内存里匹配，避免 N+1
  const ratingRows = db
    .prepare(
      'SELECT work_id, month, reviewScore, reviewStatus, scores FROM rating WHERE year = ?'
    )
    .all(year);
  const evalRows = db
    .prepare(
      `SELECT work_id, month, reviewScore, reviewStatus, reviewScores, reviewComment
         FROM evaluation WHERE year = ?`
    )
    .all(year);
  const creditRows = db
    .prepare(
      `SELECT work_id, reviewScore, reviewStatus, scores, reviewScores, reviewComment
         FROM credit WHERE year = ?`
    )
    .all(year);
  const discRows = db
    .prepare(
      'SELECT work_id, reviewScore, reviewStatus, scores FROM discipline WHERE year = ?'
    )
    .all(year);

  // ① 基础积分：只收「有记录的月份」的分数（用于算平均；具体事宜不进年度汇总）
  const basicScoresMap = new Map(); // work_id → number[]
  for (const r of ratingRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    const w = String(r.work_id).trim();
    if (!basicScoresMap.has(w)) basicScoresMap.set(w, []);
    basicScoresMap.get(w).push(Number(r.reviewScore || 0));
  }
  // ② 履职贡献：同样只收分数（先封顶 40）
  const contribScoresMap = new Map(); // work_id → number[]
  for (const r of evalRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    const w = String(r.work_id).trim();
    if (!contribScoresMap.has(w)) contribScoresMap.set(w, []);
    contribScoresMap.get(w).push(capEval40(Number(r.reviewScore || 0)));
  }
  // ③ 年度专项加分（已审核才算；审核版答案优先）
  const creditMap = new Map();
  for (const r of creditRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    creditMap.set(String(r.work_id).trim(), {
      score: Number(r.reviewScore || 0),
      matters: buildAnnualMatters(r.reviewScores || r.scores),
      comment: String(r.reviewComment || '').trim(),
    });
  }
  // ④ 年度红线扣分（已审核才算）
  const discMap = new Map();
  for (const r of discRows) {
    if (!r.work_id || r.reviewStatus !== 'reviewed') continue;
    discMap.set(String(r.work_id).trim(), {
      score: Number(r.reviewScore || 0),
      matters: buildAnnualMatters(r.scores),
    });
  }

  // 平均值：只除「有记录的月份数」，没有记录就是 0（不按 12 个月摊薄）
  const avgOf = (list = []) =>
    list.length ? list.reduce((s, x) => s + Number(x || 0), 0) / list.length : 0;

  const rows = members.map((m) => {
    const w = String(m.work_id).trim();
    // ①② 只给平均值，不带月度具体事宜（年度汇总只呈现年度口径的结果）
    const basic = avgOf(basicScoresMap.get(w) || []);
    const contribution = avgOf(contribScoresMap.get(w) || []);
    const credit = creditMap.get(w) || { score: 0, matters: [], comment: '' };
    const disc = discMap.get(w) || { score: 0, matters: [] };
    const total = basic + contribution + credit.score + disc.score;
    return {
      workId: w,
      name: m.name || '',
      position: m.job || '',
      positionType: m.type || '',
      branch: m.branch || branch,
      basic: Number(basic.toFixed(2)),
      contribution: Number(contribution.toFixed(2)),
      creditScore: Number(credit.score.toFixed(2)),
      disciplineScore: Number(disc.score.toFixed(2)),
      total: Number(total.toFixed(2)),
      // 具体事宜只有这两项（都是年度口径的一次性记录）：
      //   年度专项加分 / 年度红线扣分；空的就返回空数组，前端原样留空
      creditMatters: credit.matters,
      creditComment: credit.comment,
      disciplineMatters: disc.matters,
    };
  });

  // 总分降序（同分按工号升序，排序结果稳定可复现）
  rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.workId.localeCompare(b.workId)));

  res.json({ code: 'OK', data: { year, branch, rows } });
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

// ---------- 托管前端静态文件（dist 与 server.js 放同一目录） ----------
// 部署目录结构（以服务器为例）：
//   /home/ubuntu/pingjia/backend/server.js
//   /home/ubuntu/pingjia/backend/dist/index.html   ← 与 server.js 同级
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

// 一次性规范化「审核关系」里的工号：去空格 + 转大写，与注册落库口径（normWorkId）对齐
//   背景：关系可以先建、人后注册；若关系里存的是 ' w-0009 ' 而账号是 'W-0009'，
//   联表取姓名与「我能审谁」的匹配都会落空。存量数据在这里补齐，新写入已在接口处规范化。
function normalizeAssignmentWorkIds() {
  const r = db
    .prepare(
      `UPDATE review_assignment
          SET reviewer_work_id = UPPER(TRIM(reviewer_work_id)),
              target_work_id   = UPPER(TRIM(target_work_id))
        WHERE reviewer_work_id <> UPPER(TRIM(reviewer_work_id))
           OR target_work_id   <> UPPER(TRIM(target_work_id))`
    )
    .run();
  if (r.changes > 0) console.log(`[pingjia] 审核关系工号规范化：${r.changes} 条`);
}
try {
  normalizeAssignmentWorkIds();
} catch (e) {
  console.error('[pingjia] 审核关系工号规范化失败：', e.message);
}

function runEnsureAll(tag) {
  try {
    const r = ensureAllBranches();
    if (r.created > 0) console.log(`[pingjia] rating ${tag}补齐：${r.branches} 个支部，新增 ${r.created} 条`);
    else console.log(`[pingjia] rating ${tag}检查完成：${r.branches} 个支部，无缺失记录`);
  } catch (e) {
    // 生成失败不能拖垮服务，记录日志即可（下次定时任务会重试）
    console.error(`[pingjia] rating ${tag}补齐失败：`, e);
  }
  // 年度红线扣分（discipline）：同样在启动 / 定时补齐，跨年后自动生成新一年记录
  try {
    const d = ensureDisciplineAllBranches();
    if (d.created > 0)
      console.log(`[pingjia] discipline ${tag}补齐：${d.branches} 个支部，新增 ${d.created} 条`);
    else console.log(`[pingjia] discipline ${tag}检查完成：${d.branches} 个支部，无缺失记录`);
  } catch (e) {
    console.error(`[pingjia] discipline ${tag}补齐失败：`, e);
  }
}

runEnsureAll('启动');
setInterval(() => runEnsureAll('定时'), ENSURE_INTERVAL_MS);

// ============================================================
// 党总支书记账号已改为「白名单登记 + 自行注册」：
//   - 工号 000001 / 000002 登记为 admin_type=2（见 admin-whitelist.mjs）
//   - 不再由后端 seed 生成，故此处无内置账号逻辑
// ============================================================

app.listen(PORT, '0.0.0.0', () => console.log(`[pingjia] listening on http://0.0.0.0:${PORT}`));
