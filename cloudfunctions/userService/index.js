/**
 * userService —— 用户注册 / 登录云函数
 *
 * 访问数据库的方式：CloudBase PostgreSQL 的 HTTP API（基于 PostgREST）
 *   https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest/<表名>
 *
 * 为什么不用 pg 驱动直连 5432：
 *   免费版云函数访问数据库内网地址必须先绑定 VPC（要付费），
 *   而数据库公网地址本身也要付费。HTTP API 走的是公网 HTTPS 网关，
 *   云函数默认就有公网出口，因此不需要 VPC、也不需要数据库公网地址。
 *
 * 依赖：无（全部用 Node 18 内置的 fetch），package.json 里不需要任何依赖
 *
 * 需要配置的环境变量（控制台 → 云函数 → 函数配置 → 环境变量）：
 *   TCB_API_KEY   必填。控制台「ApiKey 管理」里的 API Key。
 *                 注意必须用 API Key（服务端用，映射 service_role，可绕过 RLS），
 *                 不要用 Publishable Key（那是给浏览器用的低权限凭证）
 *   TCB_ENV       可选。环境 ID，默认已填当前环境
 *   TCB_TABLE     可选。表名，默认 user_table
 *
 * 入参：{ action: 'ping' | 'gateway' | 'register' | 'login', payload: {...} }
 *   ping     自检：检查环境变量是否齐全（不联网）
 *   gateway  自检：请求一次数据库 HTTP API，返回状态码与响应体
 *   register 注册：写入 user_table
 *   login    登录：校验 user_id + pw
 * 出参：{ code: 'OK' | 'USER_EXISTS' | 'BAD_CREDENTIALS' | ..., message?, user? }
 */

// ---------- 配置 ----------
const ENV_ID = process.env.TCB_ENV || 'lhr20000711-d0gfnvzhdf1b2802d';
const API_KEY = process.env.TCB_API_KEY || process.env.TCB_PUBLISHABLE_KEY || '';
const TABLE = process.env.TCB_TABLE || 'user_table';
const BASE_URL = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest/${TABLE}`;

// 对外返回的字段：刻意排除 pw，避免密码泄漏到前端
const FIELDS_FULL = 'id,user_id,admin,name,type,job,branch,created_at';
const FIELDS_MIN = 'id,user_id,admin,name,type,job,branch';
let useFullFields = true; // 表里若没有 created_at，自动降级为 FIELDS_MIN

// 平台函数超时上限较严（默认 3 秒），请求超时必须更小，
// 否则函数会被平台直接杀掉，看不到真实错误原因
const REQUEST_TIMEOUT_MS = 2500;

function fields() {
  return useFullFields ? FIELDS_FULL : FIELDS_MIN;
}

// ---------- HTTP API 请求封装 ----------
async function rest(query = '', { method = 'GET', body, prefer } = {}) {
  if (!API_KEY) {
    const err = new Error('缺少环境变量 TCB_API_KEY');
    err.code = 'MISSING_KEY';
    throw err;
  }

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(BASE_URL + query, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// 从 PostgREST 的错误响应里取出上游 PostgreSQL 的错误码
function pgErrorCode(res) {
  if (res && res.data && typeof res.data === 'object' && res.data.code) return res.data.code;
  return null;
}

function pgErrorMessage(res) {
  if (res && res.data && typeof res.data === 'object') {
    return res.data.message || res.data.details || res.data.hint || `HTTP ${res.status}`;
  }
  return `HTTP ${res ? res.status : 'unknown'}`;
}

// 无论后端返回什么，都保证 pw 不外泄
function sanitize(row) {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...row };
  delete copy.pw;
  return copy;
}

// ---------- 注册 ----------
async function register(payload = {}) {
  const { user_id, pw, name, branch } = payload;
  const isAdmin = payload.admin === true || payload.admin === 'true';
  const type = isAdmin ? null : payload.type || null;
  const job = isAdmin ? null : payload.job || null;

  if (!user_id || !pw || !name || !branch) {
    return { code: 'BAD_PARAMS', message: '缺少必填字段' };
  }
  if (!isAdmin && (!type || !job)) {
    return { code: 'BAD_PARAMS', message: '员工必须填写岗位类型和岗位' };
  }

  // id 不传值，由数据库 DEFAULT 生成，用户永远无法干预
  const body = { user_id, pw, admin: isAdmin, name, type, job, branch };

  const doInsert = () =>
    rest(`?select=${fields()}`, { method: 'POST', body, prefer: 'return=representation' });

  let res = await doInsert();

  // 42703 = undefined_column：表里可能没有 created_at，降级重试一次
  if (!res.ok && pgErrorCode(res) === '42703' && useFullFields) {
    useFullFields = false;
    res = await doInsert();
  }

  if (res.ok) {
    const rows = Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) {
      // 表存在但没回传数据，多半是缺 INSERT 权限或 RLS 策略挡住了
      return {
        code: 'NO_RETURNED_ROW',
        message: '写入未返回数据，请检查该表的权限/RLS 策略是否允许插入',
      };
    }
    return { code: 'OK', user: sanitize(rows[0]) };
  }

  const errCode = pgErrorCode(res);

  // 23505 = unique_violation：user_id 已被占用。
  // 靠数据库唯一索引拦截，比"先查询再插入"更可靠（并发下不会漏）
  if (errCode === '23505') {
    return { code: 'USER_EXISTS', message: '用户名已经存在，请选择一个新的用户名' };
  }
  // 22001 = string_data_right_truncation：超出列长度定义
  if (errCode === '22001') {
    return { code: 'TOO_LONG', message: '输入内容超出长度限制' };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      code: 'PERMISSION_DENIED',
      message: '接口鉴权失败，请确认 TCB_API_KEY 填的是 API Key（不是 Publishable Key）',
      upstream: pgErrorMessage(res),
    };
  }
  if (errCode === 'PGRST205' || res.status === 404) {
    return {
      code: 'TABLE_NOT_FOUND',
      message: `数据表 ${TABLE} 不存在或不在 public schema 下`,
      upstream: pgErrorMessage(res),
    };
  }

  return { code: 'SERVER_ERROR', message: pgErrorMessage(res), upstreamCode: errCode };
}

// ---------- 登录 ----------
async function login(payload = {}) {
  const { user_id, pw } = payload;

  if (!user_id || !pw) {
    return { code: 'BAD_PARAMS', message: '请输入账号和密码' };
  }

  const q = (f) =>
    `?select=${f}&user_id=eq.${encodeURIComponent(user_id)}&pw=eq.${encodeURIComponent(pw)}&limit=1`;

  let res = await rest(q(fields()));

  if (!res.ok && pgErrorCode(res) === '42703' && useFullFields) {
    useFullFields = false;
    res = await rest(q(fields()));
  }

  if (!res.ok) {
    const errCode = pgErrorCode(res);
    if (res.status === 401 || res.status === 403) {
      return {
        code: 'PERMISSION_DENIED',
        message: '接口鉴权失败，请确认 TCB_API_KEY 填的是 API Key（不是 Publishable Key）',
        upstream: pgErrorMessage(res),
      };
    }
    if (errCode === 'PGRST205' || res.status === 404) {
      return {
        code: 'TABLE_NOT_FOUND',
        message: `数据表 ${TABLE} 不存在或不在 public schema 下`,
        upstream: pgErrorMessage(res),
      };
    }
    return { code: 'SERVER_ERROR', message: pgErrorMessage(res), upstreamCode: errCode };
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  if (rows.length === 0) {
    return { code: 'BAD_CREDENTIALS', message: '账号或密码错误' };
  }
  return { code: 'OK', user: sanitize(rows[0]) };
}

// ---------- 自检：配置检查（不联网） ----------
async function ping() {
  return {
    code: API_KEY ? 'OK' : 'MISSING_KEY',
    message: API_KEY ? '环境变量已就绪，可用 gateway 动作测试连通性' : '缺少环境变量 TCB_API_KEY',
    envId: ENV_ID,
    table: TABLE,
    url: BASE_URL,
    hasApiKey: Boolean(API_KEY),
    apiKeyPrefix: API_KEY ? `${API_KEY.slice(0, 4)}***` : null,
    note: '当前数据层走 HTTP API，不使用 PG_CONNECTION_STRING，也不需要 pg 依赖',
  };
}

// ---------- 自检：连通性探测 ----------
async function gatewayProbe() {
  const url = `${BASE_URL}?select=${fields()}&limit=1`;
  const started = Date.now();
  try {
    const res = await rest(`?select=${fields()}&limit=1`);
    return {
      code: res.ok ? 'OK' : 'HTTP_ERROR',
      url,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      body: typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500),
      rowCount: Array.isArray(res.data) ? res.data.length : null,
      hint: res.ok
        ? res.data && res.data.length
          ? '网关可用，且表里已有数据'
          : '网关可用，表可访问（当前为空表）'
        : `网关有响应但拒绝了请求：${pgErrorMessage(res)}`,
    };
  } catch (e) {
    return {
      code: e.code === 'MISSING_KEY' ? 'MISSING_KEY' : 'GATEWAY_UNREACHABLE',
      url,
      elapsedMs: Date.now() - started,
      errorName: e.name,
      errorMessage: e.message,
      hint:
        e.code === 'MISSING_KEY'
          ? '到控制台「ApiKey 管理」拿一把 API Key 填进函数环境变量'
          : '云函数连不上平台网关（少见），可能需要开公网访问',
    };
  }
}

// ---------- 入口 ----------
exports.main = async (event = {}) => {
  const { action, payload = {} } = event;

  try {
    switch (action) {
      case 'ping':
        return await ping();
      case 'gateway':
        return await gatewayProbe();
      case 'register':
        return await register(payload);
      case 'login':
        return await login(payload);
      default:
        return { code: 'BAD_ACTION', message: `未知操作：${action}` };
    }
  } catch (e) {
    console.error('[userService] 执行失败：', e);
    if (e.code === 'MISSING_KEY') {
      return { code: 'MISSING_KEY', message: '缺少环境变量 TCB_API_KEY' };
    }
    if (e.name === 'AbortError') {
      return { code: 'TIMEOUT', message: `请求数据库超时（>${REQUEST_TIMEOUT_MS}ms）` };
    }
    return { code: 'SERVER_ERROR', message: e.message || '服务异常，请稍后重试' };
  }
};
