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
  { workId: '11102000637', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: '11100027736', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: '11100016167', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },
  { workId: '11100028443', adminType: ADMIN_TYPE_LEADER, roleName: '分管领导' },

  // ----- 组织委员 admin_type=1（2）-----
  { workId: '11100032550', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },
  { workId: '11100028373', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },

  // ----- 普通党员 admin_type=3（43）-----
  { workId: '11100026755', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012387', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100001477', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100009123', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100014855', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100027376', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100026358', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11101002087', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100027577', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11200004146', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100028512', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100029058', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100029716', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032161', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032154', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032375', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032512', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034031', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034032', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034697', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035208', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035739', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035187', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012997', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012796', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012408', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017508', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017733', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017617', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100004767', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017227', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11102000647', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100031313', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100031730', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032004', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032357', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032533', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032543', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034059', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034006', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034760', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035174', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035683', adminType: ADMIN_TYPE_EMPLOYEE },

  // ----- 支部书记 admin_type=2（2：自行注册）-----
  { workId: '11100022396', adminType: ADMIN_TYPE_SECRETARY, roleName: '支部书记' },
  { workId: '11100019036', adminType: ADMIN_TYPE_SECRETARY, roleName: '支部书记' },
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

// =================================================================
// 「系统维护工具」授权名单 —— 已迁到**数据库表 permission**，可在后台在线维护
// -----------------------------------------------------------------
// 以前这里写死 TOOL_GRANTS 常量：改一次要动代码、重启服务。
// 现在改由系统管理员在 /backdoor →「权限管理」页在线增删，收回立即生效。
//
// 相关位置：
//   存储：server/party.db 的 permission 表（每行 = 一个人 + 一个工具）
//   判定：server/server.js 的 hasToolGrant() / canUseTool()
//   清单：server/server.js 的 GRANTABLE_TOOLS（唯一真源，前端从接口读）
//   接口：GET/POST/DELETE /api/backdoor/permissions（仅 admin_type=9）
//
// 本文件因此只负责「注册准入白名单」（上面的 WHITELIST），不再参与工具授权。
// =================================================================
