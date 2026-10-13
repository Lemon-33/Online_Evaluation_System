// =================================================================
// 党员工作证编号白名单（注册准入控制）— 后端副本
// -----------------------------------------------------------------
// 本文件与 src/lib/admin-whitelist.mjs 内容完全同步：
//   - src/lib/admin-whitelist.mjs 给前端用（Vite 打包进 dist）
//   - 本文件给后端用（Node ESM 直接 import）
// 改完任一份，请立刻同步另一份。
// 完整说明见 src/lib/admin-whitelist.mjs 顶部注释。
// =================================================================

export const ADMIN_TYPE_LEADER = 0;
export const ADMIN_TYPE_ORGANIZER = 1;

export const ADMIN_WORK_IDS = [
  { workId: 'W-0001', adminType: ADMIN_TYPE_LEADER,    roleName: '分管领导' },
  { workId: 'W-0002', adminType: ADMIN_TYPE_LEADER,    roleName: '分管领导' },
  { workId: 'W-0003', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },
  { workId: 'W-0004', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },
];

export const USER_WORK_IDS = [
  { workId: 'W-0005' }, { workId: 'W-0006' }, { workId: 'W-0007' }, { workId: 'W-0008' },
  { workId: 'W-0009' }, { workId: 'W-0010' }, { workId: 'W-0011' }, { workId: 'W-0012' },
  { workId: 'W-0013' }, { workId: 'W-0014' }, { workId: 'W-0015' }, { workId: 'W-0016' },
  { workId: 'W-0017' }, { workId: 'W-0018' }, { workId: 'W-0019' }, { workId: 'W-0020' },
  { workId: 'W-0021' }, { workId: 'W-0022' }, { workId: 'W-0023' }, { workId: 'W-0024' },
  { workId: 'W-0025' }, { workId: 'W-0026' }, { workId: 'W-0027' }, { workId: 'W-0028' },
  { workId: 'W-0029' }, { workId: 'W-0030' }, { workId: 'W-0031' }, { workId: 'W-0032' },
  { workId: 'W-0033' }, { workId: 'W-0034' }, { workId: 'W-0035' }, { workId: 'W-0036' },
  { workId: 'W-0037' }, { workId: 'W-0038' }, { workId: 'W-0039' }, { workId: 'W-0040' },
  { workId: 'W-0041' }, { workId: 'W-0042' }, { workId: 'W-0043' }, { workId: 'W-0044' },
  { workId: 'W-0045' }, { workId: 'W-0046' }, { workId: 'W-0047' }, { workId: 'W-0048' },
  { workId: 'W-0049' }, { workId: 'W-0050' },
];

const _byId = new Map();
for (const x of [...ADMIN_WORK_IDS, ...USER_WORK_IDS]) {
  _byId.set(x.workId.toLowerCase(), x);
}

export function lookupWorkId(workId) {
  if (!workId) return null;
  const item = _byId.get(String(workId).toLowerCase());
  if (!item) return null;
  if (item.adminType !== undefined) {
    return { kind: 'admin', adminType: item.adminType, roleName: item.roleName };
  }
  return { kind: 'user' };
}

export function isInWhitelist(workId) {
  if (!workId) return false;
  return _byId.has(String(workId).toLowerCase());
}
