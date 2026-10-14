// =================================================================
// 党员工作证编号白名单（注册准入控制）— 后端唯一真源
// -----------------------------------------------------------------
// 注册时按 work_id 查本表，直接用其中登记的 adminType 落库；
// 前端不再持有副本、也不做白名单校验（提交时由后端判定）。
//
// admin_type 语义：
//   0 = 分管领导   只审核履职贡献、不自评；岗位类型可留空
//   1 = 组织委员   履职贡献自评 + 基础积分评价；必须填岗位类型
//   2 = 支部书记   履职贡献审核 + 基础积分评价（范围全体）；岗位类型可留空
//   3 = 普通党员   履职贡献自评 + 只读查看；必须填岗位类型
//
// 说明：支部书记不再由后端 seed 生成，改为在本表登记、自行注册。
// =================================================================

export const ADMIN_TYPE_LEADER = 0;    // 分管领导
export const ADMIN_TYPE_ORGANIZER = 1; // 组织委员
export const ADMIN_TYPE_SECRETARY = 2; // 支部书记
export const ADMIN_TYPE_EMPLOYEE = 3;  // 普通党员

// 单条结构：{ workId, adminType, roleName? }
//   roleName 仅用于日志 / 提示，不参与鉴权
export const WHITELIST = [
  // ----- 分管领导 admin_type=0（4）-----
  { workId: 'W-0001', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: 'W-0002', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: 'W-0003', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: 'W-0004', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },

  // ----- 组织委员 admin_type=1（2）-----
  { workId: 'W-0005', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },
  { workId: 'W-0006', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },

  // ----- 普通党员 admin_type=3（42：W-0007 ~ W-0048）-----
  { workId: 'W-0007', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0008', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0009', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0010', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0011', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0012', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0013', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0014', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0015', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0016', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0017', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0018', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0019', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0020', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0021', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0022', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0023', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0024', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0025', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0026', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0027', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0028', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0029', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0030', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0031', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0032', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0033', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0034', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0035', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0036', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0037', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0038', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0039', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0040', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0041', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0042', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0043', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0044', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0045', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0046', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0047', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: 'W-0048', adminType: ADMIN_TYPE_EMPLOYEE },

  // ----- 支部书记 admin_type=2（2：自行注册）-----
  { workId: '000001', adminType: ADMIN_TYPE_SECRETARY, roleName: '支部书记' },
  { workId: '000002', adminType: ADMIN_TYPE_SECRETARY, roleName: '支部书记' },
];

const _byId = new Map();
for (const x of WHITELIST) _byId.set(String(x.workId).toLowerCase(), x);

// 返回命中的白名单条目 { workId, adminType, roleName? }；不在名单返回 null
export function lookupWorkId(workId) {
  if (!workId) return null;
  return _byId.get(String(workId).toLowerCase()) || null;
}

export function isInWhitelist(workId) {
  if (!workId) return false;
  return _byId.has(String(workId).toLowerCase());
}
