// =================================================================
// 党员工作证编号白名单（注册准入控制）— 后端唯一真源
// -----------------------------------------------------------------
// 注册时按 work_id 查本表，直接用其中登记的 adminType 落库；
// 前端不再持有副本、也不做白名单校验（提交时由后端判定）。
//
// admin_type 语义：
//   0 = 支部书记     只审核履职贡献、不自评；岗位类型可留空
//   1 = 组织委员     履职贡献自评 + 基础积分评价；必须填岗位类型
//   2 = 党总支书记   履职贡献审核 + 基础积分评价（范围全体）；岗位类型可留空
//   3 = 普通党员     履职贡献自评 + 只读查看；必须填岗位类型
//   4 = 分管领导     只审核履职贡献、不自评；不参与基础积分评价 / 年度红线扣分 /
//                    年度专项加分；岗位类型可留空。侧边栏恒有「履职贡献评价审核」
//                    入口（即便没有被指派审核对象），其余模块一律不出现
//
// 说明：党总支书记不再由后端 seed 生成，改为在本表登记、自行注册。
// =================================================================

export const ADMIN_TYPE_LEADER = 0;    // 支部书记
export const ADMIN_TYPE_ORGANIZER = 1; // 组织委员
export const ADMIN_TYPE_SECRETARY = 2; // 党总支书记
export const ADMIN_TYPE_EMPLOYEE = 3;  // 普通党员
export const ADMIN_TYPE_DIRECTOR = 4;  // 分管领导

// 单条结构：{ workId, name, branch, adminType, roleName? }
//   roleName 仅用于日志 / 提示，不参与鉴权
//   name / branch 取自《供服二中心党员信息表》—— 注册时**不再让用户选支部**，
//   直接以这里登记的 branch 落库，避免本人选错：
//     'first'  = 第一党支部
//     'second' = 第二党支部
//   （与 src/lib/constants.js 的 BRANCHES[].value 保持一致）
export const WHITELIST = [
  // ----- 支部书记 admin_type=0（2）-----
  { workId: '11102000637', name: '钱勇', branch: 'first', adminType: ADMIN_TYPE_LEADER, roleName: '支部书记' },
  { workId: '11100027736', name: '邓鹏', branch: 'second', adminType: ADMIN_TYPE_LEADER, roleName: '支部书记' },

  // ----- 分管领导 admin_type=4（2：2026-10-18 从支部书记类别移入）-----
  { workId: '11100016167', name: '吴辉', branch: 'second', adminType: ADMIN_TYPE_DIRECTOR, roleName: '分管领导' },
  { workId: '11100028443', name: '张英娇', branch: 'first', adminType: ADMIN_TYPE_DIRECTOR, roleName: '分管领导' },

  // ----- 组织委员 admin_type=1（2）-----
  { workId: '11100032550', name: '赵博阳', branch: 'first', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },
  { workId: '11100028373', name: '徐微微', branch: 'second', adminType: ADMIN_TYPE_ORGANIZER, roleName: '组织委员' },

  // ----- 普通党员 admin_type=3（43）-----
  { workId: '11100026755', name: '何红梅', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012387', name: '刘晖', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100001477', name: '马戎', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100009123', name: '郭松', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100014855', name: '王隽', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100027376', name: '朱海超', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100026358', name: '周昊', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11101002087', name: '张晶', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100027577', name: '张晨静', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11200004146', name: '吴浩东', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100028512', name: '汝钟婉', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100029058', name: '傅乔清', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100029716', name: '刘昱', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032161', name: '张书玮', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032154', name: '滕国钧', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032375', name: '钱雨飞', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032512', name: '张鑫', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034031', name: '朱泽', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034032', name: '张胤', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034697', name: '花赟玥', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035208', name: '王毅松', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035739', name: '金雨彤', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035187', name: '孔亮', branch: 'first', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012997', name: '傅恩雨', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012796', name: '李海涛', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100012408', name: '侯春宁', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017508', name: '王凌', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017733', name: '林海', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017617', name: '张健', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100004767', name: '施志强', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100017227', name: '袁越', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11102000647', name: '李想', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100031313', name: '田园', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100031730', name: '袁翌晖', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032004', name: '唐聪', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032357', name: '皮守苗', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032533', name: '刘子菡', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100032543', name: '胡文岳', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034059', name: '邢泽洲', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034006', name: '毛近贤', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100034760', name: '高志民', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035174', name: '曾岚兰', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },
  { workId: '11100035683', name: '王梓桐', branch: 'second', adminType: ADMIN_TYPE_EMPLOYEE },

  // ----- 党总支书记 admin_type=2（2：自行注册）-----
  { workId: '11100022396', name: '汪蕾', branch: 'second', adminType: ADMIN_TYPE_SECRETARY, roleName: '党总支书记' },
  { workId: '11100019036', name: '冯隆基', branch: 'first', adminType: ADMIN_TYPE_SECRETARY, roleName: '党总支书记' },
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
