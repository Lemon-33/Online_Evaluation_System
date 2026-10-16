import {
  AuditOutlined,
  EditOutlined,
  IdcardOutlined,
  LineChartOutlined,
  ProfileOutlined,
  RiseOutlined,
  ShareAltOutlined,
  StarOutlined,
  WarningOutlined,
} from '@ant-design/icons';

// ============================================================
// 侧边栏菜单的唯一定义源
// ------------------------------------------------------------
// 以前菜单散在 AppLayout.jsx 里内联写死，现在抽到这里，供三处复用：
//   ① 侧边栏渲染（AppLayout）
//   ②「个人信息 → 侧边栏排序」里列出可排序的模块（Profile）
//   ③ 排序结果存库时只存 key 数组
// 新增模块时只改这里（顺序即默认顺序），其它地方自动生效。
//   perm 对应 AuthContext.can(action) 的 key；icon 存组件本身（不在 .js 里写 JSX）
// ============================================================
export const MENU_ITEMS = [
  // 「党员自我评价提交」放第一位：普通党员 / 组织委员登录后默认进这里
  //   （提交类工作的总入口，里面再分「履职贡献自评」和「年度专项加分」）
  {
    key: '/self-center',
    perm: 'selfCenter',
    label: '党员自我评价提交',
    icon: EditOutlined,
  },
  {
    key: '/score-query',
    perm: 'scoreQuery',
    label: '个人积分查询',
    icon: LineChartOutlined,
  },
  {
    key: '/basic-rating',
    perm: 'basicRating',
    label: '基础积分评价',
    icon: StarOutlined,
  },
  {
    key: '/score-summary',
    perm: 'scoreSummary',
    label: '支部积分汇总',
    icon: LineChartOutlined,
  },
  // 注：「每月履职贡献自评」（/self）自 2026-10-16 起从侧边栏隐藏 ——
  //   入口已并入「党员自我评价提交」（上面的第一项），
  //   「个人积分查询 → 当月履职贡献积分 → 提交 / 修改 / 查看自评」也能直接进。
  //   路由 /self 与 perm 'self' 都保留（页面仍要能用），只是不出现在菜单里。
  //   已保存过侧边栏顺序的用户排序里可能还留着这个 key，无害（过滤后不显示）。
  // 注：原「基础积分评价查看」入口已于 2026-10-16 从侧边栏移除 ——
  //   常驻一个空表单没意义，改为从「个人积分查询 → 某月 → 查看评价」进入（路由仍保留）。
  {
    key: '/review',
    perm: 'review',
    label: '履职贡献评价审核',
    icon: AuditOutlined,
  },
  // ===== 系统维护工具：默认对所有人隐藏（can(...) 恒 false）=====
  //   由系统管理员在 /backdoor →「权限管理」里授权后才出现
  {
    key: '/user-admin',
    perm: 'userAdmin',
    label: '员工信息维护',
    icon: IdcardOutlined,
  },
  {
    key: '/review-assign',
    perm: 'reviewAssign',
    label: '审核关系维护',
    icon: ShareAltOutlined,
  },
  {
    key: '/form-override',
    perm: 'formOverride',
    label: '个人问卷维护',
    icon: ProfileOutlined,
  },
  // 年度红线扣分审核（分管领导 / 支部书记可见）
  {
    key: '/redline-review',
    perm: 'redline',
    label: '年度红线扣分审核',
    icon: WarningOutlined,
  },
  // 年度专项加分审核（分管领导 / 支部书记可见，读 credit 表）
  {
    key: '/credit-review',
    perm: 'creditReview',
    label: '年度专项加分审核',
    icon: RiseOutlined,
  },
  // 注：系统管理员的入口在 /backdoor（独立布局，不走本侧边栏）
];

// 按 key 取菜单定义（排序回显时用）
export const findMenuItem = (key) => MENU_ITEMS.find((it) => it.key === key) || null;
export const menuLabelOf = (key) => findMenuItem(key)?.label || key;
export const menuIconOf = (key) => findMenuItem(key)?.icon || null;

// 按用户自定义顺序排序：
//   order 里出现过的 key 按其在 order 中的下标排；没出现过的（新增模块 / 新授权的工具）
//   排到最后，并保持 MENU_ITEMS 里的默认相对顺序（Array.sort 是稳定排序）
export function sortMenuItems(items = [], order = []) {
  const arr = Array.isArray(order) ? order : [];
  const idxOf = (k) => {
    const i = arr.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...items].sort((a, b) => idxOf(a.key) - idxOf(b.key));
}

// 把顺序在数组里移动一位（上移 / 下移），越界返回原数组
export function moveMenuItem(list = [], index, delta) {
  const next = [...list];
  const target = index + delta;
  if (index < 0 || index >= next.length) return next;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
