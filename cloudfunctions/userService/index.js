/**
 * userService —— 用户注册 / 登录云函数
 *
 * 为什么必须用云函数：前端不能直连 PostgreSQL，
 * 否则数据库连接串（含密码）会被打进前端包里公开。
 *
 * 依赖：pg
 * 需要配置的环境变量（在 CloudBase 控制台 → 云函数 → 配置里填）：
 *   PG_CONNECTION_STRING  postgresql://用户名:密码@主机:端口/数据库名
 *   PG_SSL                可选，'true' 时启用 SSL（用公网地址连接时需要）
 *
 * 入参：{ action: 'register' | 'login', payload: {...} }
 * 出参：{ code: 'OK' | 'USER_EXISTS' | 'BAD_CREDENTIALS' | ..., message?, user? }
 */

const { Pool } = require('pg');

// ---------- 连接池（模块级复用，云函数热启动时不会重复建连） ----------
let pool = null;

function getPool() {
  if (!pool) {
    if (!process.env.PG_CONNECTION_STRING) {
      throw new Error('缺少环境变量 PG_CONNECTION_STRING');
    }
    pool = new Pool({
      connectionString: process.env.PG_CONNECTION_STRING,
      max: 5, // 云函数并发有限，5 个连接足够
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', (err) => console.error('[pg pool error]', err));
  }
  return pool;
}

// 对外返回的字段：刻意排除 pw，避免密码泄漏到前端
const PUBLIC_FIELDS = 'id, user_id, admin, name, type, job, branch, created_at';

// ---------- 注册 ----------
async function register({ user_id, pw, name, admin = false, type = null, job = null, branch }) {
  const isAdmin = admin === true || admin === 'true';

  if (!user_id || !pw || !name || !branch) {
    return { code: 'BAD_PARAMS', message: '缺少必填字段' };
  }
  if (!isAdmin && (!type || !job)) {
    return { code: 'BAD_PARAMS', message: '员工必须填写岗位类型和岗位' };
  }

  // id 不传值，由数据库 DEFAULT gen_random_uuid() 生成，用户永远无法干预
  const sql = `
    INSERT INTO user_table (user_id, pw, admin, name, type, job, branch)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING ${PUBLIC_FIELDS}
  `;
  const params = [
    user_id,
    pw,
    isAdmin,
    name,
    isAdmin ? null : type, // 管理员不允许写入岗位信息
    isAdmin ? null : job,
    branch,
  ];

  try {
    const { rows } = await getPool().query(sql, params);
    return { code: 'OK', user: rows[0] };
  } catch (e) {
    // 23505 = unique_violation：user_id 已被占用
    // 直接靠唯一索引拦截，比"先查询再插入"更可靠（并发下不会漏）
    if (e.code === '23505') {
      return { code: 'USER_EXISTS', message: '用户名已经存在，请选择一个新的用户名' };
    }
    // 22001 = string_data_right_truncation：超出列长度定义
    if (e.code === '22001') {
      return { code: 'TOO_LONG', message: '输入内容超出长度限制' };
    }
    throw e;
  }
}

// ---------- 登录 ----------
async function login({ user_id, pw }) {
  if (!user_id || !pw) {
    return { code: 'BAD_PARAMS', message: '请输入账号和密码' };
  }

  const { rows } = await getPool().query(
    `SELECT ${PUBLIC_FIELDS} FROM user_table WHERE user_id = $1 AND pw = $2 LIMIT 1`,
    [user_id, pw]
  );

  if (rows.length === 0) {
    return { code: 'BAD_CREDENTIALS', message: '账号或密码错误' };
  }
  return { code: 'OK', user: rows[0] };
}

// ---------- 入口 ----------
exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    switch (action) {
      case 'register':
        return await register(payload);
      case 'login':
        return await login(payload);
      default:
        return { code: 'BAD_ACTION', message: `未知操作：${action}` };
    }
  } catch (e) {
    console.error('[userService] 执行失败：', e);
    return { code: 'SERVER_ERROR', message: e.message || '服务异常，请稍后重试' };
  }
};
