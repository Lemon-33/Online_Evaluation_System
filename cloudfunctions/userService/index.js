/**
 * userService —— 用户注册 / 登录云函数（事件函数，非 HTTP 函数）
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
 *                 必须用 API Key（服务端用，映射 service_role，可绕过 RLS），
 *                 不要用 Publishable Key（那是给浏览器用的低权限凭证）
 *   TCB_ENV       必填（换新环境时）。环境 ID
 *   TCB_TABLE     可选。表名，默认 user_table
 *
 * 入参：{ action: 'ping' | 'gateway' | 'register' | 'login', payload: {...} }
 *   ping     自检：检查环境变量是否齐全（不联网）
 *   gateway  自检：请求一次数据库 HTTP API，返回状态码、行数、耗时
 *   register 注册：写入 user_table（user_id 唯一）
 *   login    登录：校验 user_id + pw
 * 出参：{ code: 'OK' | 'USER_EXISTS' | 'BAD_CREDENTIALS' | ..., message?, user? }
 *
 * 重要：返回的 user 对象绝不包含 pw 字段
 */

// ---------- 配置 ----------
const ENV_ID = process.env.TCB_ENV || 'lhr20000711-d0gfnvzhdf1b2802d'; // 换新环境时必须改
const API_KEY = process.env.TCB_API_KEY || '';
const TABLE = process.env.TCB_TABLE || 'user_table';
const BASE = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const REQUEST_TIMEOUT_MS = 2500;

// 查询/返回时用的字段（不含 pw）
const FIELDS = ['user_id', 'name', 'admin', 'type', 'job', 'branch', 'created_at'];
const fields = () => FIELDS.join(',');

// ---------- PostgREST 请求封装 ----------
async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!API_KEY) {
    throw Object.assign(new Error('缺少 TCB_API_KEY'), { code: 'MISSING_KEY' });
  }
  const url = `${BASE}/${TABLE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON，保留原文 */ }
    return { status: res.status, ok: res.ok, data, text };
  } finally {
    clearTimeout(timer);
  }
}

// 上游错误信息摘要（排查用，截断防刷屏）
function upstream(res) {
  return { httpStatus: res.status, body: (res.text || '').slice(0, 300) };
}

// PostgREST 错误码判断
const isTableMissing = (r) => r.status === 404 || (r.data && r.data.code === 'PGRST205');
const isNoPermission = (r) => r.status === 401 || r.status === 403;
const isDup = (r) => r.status === 409 || (r.data && (r.data.code === '23505' || String(r.data.message || '').includes('duplicate key')));
const isColumnMissing = (r) => r.data && (r.data.code === 'PGRST204' || r.data.code === '42703');

// ---------- ping：配置自检（不联网） ----------
async function ping() {
  return {
    code: API_KEY ? 'OK' : 'MISSING_KEY',
    envId: ENV_ID,
    table: TABLE,
    hasApiKey: !!API_KEY,
    hint: API_KEY
      ? '配置齐全，可执行 gateway / register / login'
      : '缺少环境变量 TCB_API_KEY，请到函数配置 → 环境变量里设置',
  };
}

// ---------- gateway：数据库连通性探测 ----------
async function gatewayProbe() {
  const url = `${BASE}/${TABLE}?select=user_id&limit=0`;
  if (!API_KEY) {
    return { code: 'MISSING_KEY', url, hint: '缺少环境变量 TCB_API_KEY' };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    // PostgREST 用 Content-Range 头返回总数：0-0/12 → 12
    let rowCount = null;
    const range = res.headers.get('content-range');
    if (range && range.includes('/')) {
      const total = range.split('/')[1];
      if (total !== '*') rowCount = Number(total);
    }
    return {
      code: res.ok ? 'OK' : 'HTTP_ERROR',
      url,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      rowCount,
      body: text.slice(0, 500),
      hint: res.ok
        ? '网关可用：注册/登录走这条路，不需要 VPC 和数据库公网地址'
        : '网关有响应但拒绝了请求，看 body 内容定位（多半是 Key 类型或权限）',
    };
  } catch (e) {
    return {
      code: 'GATEWAY_UNREACHABLE',
      url,
      elapsedMs: Date.now() - started,
      errorName: e.name,
      errorMessage: e.message,
      hint: '云函数连不上平台网关（少见），可能需要开公网访问',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- register：注册 ----------
async function register({ user_id, pw, name, admin = false, type = null, job = null, branch }) {
  if (!user_id || !pw || !name || !branch) {
    return { code: 'BAD_REQUEST', message: 'user_id、pw、name、branch 必填' };
  }
  if (String(pw).length < 6) {
    return { code: 'BAD_REQUEST', message: '密码至少 6 位' };
  }

  // 先查一遍，给出比唯一索引报错更友好的提示
  const dup = await rest(`?select=user_id&user_id=eq.${encodeURIComponent(user_id)}&limit=1`);
  if (dup.ok && Array.isArray(dup.data) && dup.data.length > 0) {
    return { code: 'USER_EXISTS', message: '该账号已注册' };
  }

  const baseBody = {
    user_id: String(user_id).trim(),
    pw: String(pw),
    name: String(name).trim(),
    admin: !!admin,
    type: type || null,
    job: job || null,
    branch: String(branch).trim(),
  };

  const doInsert = (withCreatedAt) =>
    rest(`?select=${fields()}`, {
      method: 'POST',
      body: withCreatedAt ? { ...baseBody, created_at: new Date().toISOString() } : baseBody,
      prefer: 'return=representation',
    });

  let res = await doInsert(true);

  // created_at 列不存在时降级：去掉时间戳再插一次
  if (!res.ok && isColumnMissing(res)) {
    res = await doInsert(false);
  }

  if (isTableMissing(res)) {
    return { code: 'TABLE_NOT_FOUND', message: `表 ${TABLE} 不存在（或不在 public schema）`, upstream: upstream(res) };
  }
  if (isNoPermission(res)) {
    return { code: 'PERMISSION_DENIED', message: 'API Key 无权访问该表，检查 Key 类型或表授权', upstream: upstream(res) };
  }
  if (isDup(res)) {
    return { code: 'USER_EXISTS', message: '该账号已注册' };
  }
  if (!res.ok) {
    return { code: 'INSERT_FAILED', message: `写入失败（HTTP ${res.status}）`, upstream: upstream(res) };
  }

  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    return { code: 'NO_RETURNED_ROW', message: '写入成功但未返回数据，检查权限/RLS', upstream: upstream(res) };
  }
  return { code: 'OK', user: row };
}

// ---------- login：登录 ----------
async function login({ user_id, pw }) {
  if (!user_id || !pw) {
    return { code: 'BAD_REQUEST', message: 'user_id、pw 必填' };
  }

  const q = `?select=${fields()}&user_id=eq.${encodeURIComponent(user_id)}&pw=eq.${encodeURIComponent(pw)}&limit=1`;
  const res = await rest(q);

  if (isTableMissing(res)) {
    return { code: 'TABLE_NOT_FOUND', message: `表 ${TABLE} 不存在（或不在 public schema）`, upstream: upstream(res) };
  }
  if (isNoPermission(res)) {
    return { code: 'PERMISSION_DENIED', message: 'API Key 无权访问该表，检查 Key 类型或表授权', upstream: upstream(res) };
  }
  if (!res.ok) {
    return { code: 'QUERY_FAILED', message: `查询失败（HTTP ${res.status}）`, upstream: upstream(res) };
  }

  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) {
    return { code: 'BAD_CREDENTIALS', message: '账号或密码错误' };
  }
  return { code: 'OK', user: row };
}

// ---------- 入口（事件函数） ----------
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
