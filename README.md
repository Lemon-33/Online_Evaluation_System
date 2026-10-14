# 党员评价系统

> **前端**：React 18 + Vite 5 + Ant Design 5
> **后端**：Node + Express + SQLite（better-sqlite3），代码在 `server/`，接口统一 `/api/*`
> 两条业务线：**每月履职贡献**（自评 → 审核）与 **基础积分**（组织委员 / 支部书记评价），另含个人积分查询、评价汇总与 Excel 导出。

## 功能

| 模块 | 说明 | 谁能用 |
| --- | --- | --- |
| 每月履职贡献自评 | 按月提交自评（同一人同年同月一条，重复提交覆盖；该月已审核则锁定不可改） | 组织委员(1)、普通党员(3) |
| 履职贡献评价审核 | 按指派的名单审核、定稿、删除 | 分管领导(0)、班长、支部书记(2) |
| 基础积分评价 | 以「扣分问卷」形式评分（满分 100，按扣项累减） | 组织委员(1)、支部书记(2) |
| 基础积分评价查看 | 只读查看本人各月基础积分与最终得分 | 组织委员(1)、普通党员(3) |
| 个人积分查询 | 按月 / 按年查询本人积分（基础分 + 履职贡献分 + 加分 / 扣分） | 组织委员(1)、普通党员(3) |
| 评价汇总 / 导出 | 履职贡献列表统计 + 一键导出 Excel | 能审核的人 |
| 个人信息 | 查看 / 修改本人资料 | 登录即可 |

## 快速开始（本地）

**后端**（Express + SQLite）：

```bash
cd server
npm install
node server.js          # 监听 0.0.0.0:3000，数据库文件 server/party.db（首次启动自动创建）
```

**前端**：

```bash
npm install
npm run dev             # http://localhost:5173，/api 反向代理到 VITE_PROXY_TARGET
```

**生产构建**：

```bash
npm run build           # 产物在 dist/
```

环境变量（可选，写进 `.env.local`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 空 | 留空 = 同域直接请求 `/api/*` |
| `VITE_PROXY_TARGET` | `http://124.220.236.13` | 本地开发时 `/api` 的反代目标 |
| `VITE_PUBLIC_BASE` | `/` | 静态资源前缀 |
| `VITE_USE_MOCK` | 未设 | `true` = 前端降级到 localStorage，不连后端 |

> 未安装 Node.js 时请先装 LTS 版本（≥18）。

## 身份与权限

### 身份（`admin_type`）

**所有人同一个登录入口、同一套界面**，只有菜单和数据范围按身份不同。身份**只由工号决定**，注册页不让用户选身份。

| admin_type | 身份 | 工号来源 | 是否自评 | 岗位类型 |
| --- | --- | --- | --- | --- |
| 0 | 分管领导 | 白名单 | 否 | 可留空 |
| 1 | 组织委员 | 白名单 | 是 | **必填** |
| 2 | 支部书记 | 白名单 | 否 | 可留空 |
| 3 | 普通党员 | 白名单 | 是 | **必填** |

白名单**唯一真源**是 `server/admin-whitelist.mjs`（前端不持有副本），当前登记：

| 工号区间 | admin_type | 身份 | 人数 |
| --- | --- | --- | --- |
| `W-0001` ~ `W-0004` | 0 | 分管领导 | 4 |
| `W-0005` ~ `W-0006` | 1 | 组织委员 | 2 |
| `W-0007` ~ `W-0048` | 3 | 普通党员 | 42 |
| `000001` / `000002` | 2 | 支部书记 | 2 |

### 菜单矩阵

| admin_type | 侧边栏 |
| --- | --- |
| 3 普通党员 | 每月履职贡献自评 · 基础积分评价查看 · 履职贡献评价审核（**仅有审核对象时**）· 个人积分查询 |
| 1 组织委员 | 上面前四项 + **基础积分评价** |
| 0 分管领导 | 仅 **履职贡献评价审核** |
| 2 支部书记 | 履职贡献评价审核 · 基础积分评价 |

### 数据范围（后端强制，前端参数不可越权）

| 业务线 | 谁 | 能看到 / 能审谁 |
| --- | --- | --- |
| 履职贡献 | 分管领导(0)、班长 | `review_assignment` 里**指给我**的人 |
| 履职贡献 | 支部书记(2) | **全体** |
| 履职贡献 | 本人 | 始终能看到自己的自评 |
| 基础积分 | 组织委员(1) | **本支部** `admin_type IN (1, 3)`，**含自己** |
| 基础积分 | 支部书记(2) | **全体** |
| 个人积分查询 | 组织委员(1) / 普通党员(3) | 只能查**自己** |

### 登录后默认落地页

定义在 `src/lib/constants.js` 的 `homePath()`：

| 身份 | 落地页 |
| --- | --- |
| 分管领导(0) / 支部书记(2) | `/review` |
| 组织委员(1) | `/basic-rating` |
| 普通党员(3) | `/self` |

越权访问会**静默重定向**回自己的工作台首屏，不显示错误页。

## 岗位类型 → 岗位（级联选择）

注册时**先选岗位类型，再选岗位**；切换类型会自动清空已选岗位。定义在 `src/lib/constants.js` 的 `POSITION_TYPES` / `POSITIONS_BY_TYPE`。

| 岗位类型 | value | 可选岗位 |
| --- | --- | --- |
| 专业技术岗位党员 | `professional` | 配网专业技术岗、营销专业技术岗、工程专业技术岗、综合事务岗 |
| 班组长岗位党员 | `teamLeader` | 营业班班长、大客户班班长、低压综合服务班班长、配电运检班班长、配电工程班班长 |
| 班组成员岗位党员 | `teamMember` | 营业班班组成员、大客户班班组成员、低压综合服务班班组成员、配电运检班班组成员、配电工程班班组成员 |

> 组织委员(1) / 普通党员(3) **必填**；分管领导(0) / 支部书记(2) 可留空。是否需要填写由**后端**按工号判定（留空返回 `POSITION_REQUIRED`），前端不做预校验。

## 所在党支部（`branch`）

定义在 `src/lib/constants.js` 的 `BRANCHES`（第一党支部 / 第二党支部）。

| 身份 | 「党支部」的含义 | 作用 |
| --- | --- | --- |
| 普通党员(3) / 组织委员(1) | 我**属于**哪个支部 | 自评记录带上所属支部 |
| 组织委员(1) | 我**负责评价**哪个支部 | 基础积分范围 = 本支部 `admin_type IN (1, 3)`（含自己） |
| 支部书记(2) | — | 可见全体，不受支部限制 |

## 审核关系（`review_assignment`）

「谁审谁」由 SQLite 表 `review_assignment` 显式决定，代码**不做**按支部 / 岗位的自动匹配。

- 分管领导、班长 → 手工登记各自的被审对象（支持后期直接改库维护）。
- 支部书记 → **不登记**：范围 = 全体（`admin_type = 2` 在代码里特判）。
- 没有被指派任何审核对象的人 → 菜单里不出现「履职贡献评价审核」。
- 审核对象变化后，被指派者需**重新登录**才会刷新菜单（`hasReviewTargets` 在登录时下发）。

维护 SQL 与常见场景见 **`部署与审核关系维护.md` §6**。

## 基础积分评价

| 谁 | 范围 |
| --- | --- |
| 组织委员(1) | 本支部 `admin_type IN (1, 3)`，**含自己** |
| 支部书记(2) | **全体** |

- 被评对象集合是 `server/server.js` 里的常量 `BASIC_RATING_TYPES = [1, 3]`；以后要把分管领导 / 支部书记也纳入被评名单，**只改这一个数组**。
- 记录**惰性生成**：本支部第一个组织委员 / 支部书记打开某月页面时，为该支部所有 `admin_type IN (1,3)` 的人补一条 `pending` 记录。
- 分管领导(0) 既不自评、也没有基础积分记录，只作为**审核人**存在。

## 页面与路由

| 路由 | 页面 | 权限 key |
| --- | --- | --- |
| `/login`、`/register` | 登录 / 注册 | 公开 |
| `/`、`*` | 按身份跳到工作台 | 登录 |
| `/self` | 每月履职贡献自评 | `self` |
| `/review`、`/review-form/:id` | 履职贡献评价审核 / 整页审核表单 | `review` |
| `/list` | 评价汇总 + Excel 导出 | `list` |
| `/basic-rating` | 基础积分评价 | `basicRating` |
| `/basic-rating/deduct/:id` | 扣分问卷评分 | `deductRating` |
| `/basic-rating-view` | 基础积分评价查看 | `basicRatingView` |
| `/score-query` | 个人积分查询 | `scoreQuery` |
| `/profile` | 个人信息 | 登录即可 |

权限由两处决定：后端 `server/server.js` 的**谓词 + 数据范围**（真正的边界），前端 `src/context/AuthContext.jsx` 的 `can()`（只控制菜单与路由显隐）。

## 目录结构

```
├─ index.html
├─ package.json
├─ vite.config.js              # 开发代理 / 构建配置
├─ README.md
├─ 部署与审核关系维护.md          # 部署步骤 + 审核关系维护 SQL
├─ server/                     # 后端（Express + SQLite）
│  ├─ server.js                # 接口 + 建表 + 身份谓词 + 数据范围
│  ├─ admin-whitelist.mjs      # 工号白名单（身份唯一真源）
│  ├─ package.json
│  └─ party.db                 # 运行时自动生成（勿提交）
├─ src/
│  ├─ App.jsx                  # 路由 + 权限守卫
│  ├─ main.jsx
│  ├─ styles.css
│  ├─ components/AppLayout.jsx # 侧边栏 + 顶栏
│  ├─ context/AuthContext.jsx  # 注册 / 登录 / can() 权限矩阵
│  ├─ lib/
│  │  ├─ cloudbase.js          # 前端数据访问层（fetch + Bearer token + Mock 兜底）
│  │  ├─ userService.js        # 注册 / 登录 / 字段映射
│  │  ├─ constants.js          # 身份常量 / 岗位 / 支部 / 落地页
│  │  ├─ deduction-form.js     # 基础积分扣分问卷定义与算分
│  │  ├─ forms-data.mjs        # 履职贡献表单数据
│  │  └─ excel.js              # Excel 导出
│  └─ pages/                   # Login / Register / SelfEvaluation / Review / ReviewForm /
│                              # EvaluationList / BasicRating / DeductionRating /
│                              # BasicRatingView / ScoreQuery / Profile
└─ dist/                       # 构建产物（部署时与 server.js 同级）
```

## 部署

简要流程：**构建 → 上传 → 清库 → 重启**。

1. `npm run build` 生成 `dist/`；
2. 上传 `server/server.js`、`server/admin-whitelist.mjs` 和整个 `dist/`；
3. 结构性改动（去掉 `admin` 列、新增 `review_assignment`）必须**删除服务器上的 `party.db`** 后重启，表会按新结构重建；
4. 重启后端 `node server.js`。

完整步骤、清库原因、验证清单与排错表见 **`部署与审核关系维护.md`**。

## 已知遗留 / 待办

- `pw` 目前是**明文**存储（演示用）。上线前建议改为 bcrypt 哈希（`pw` 列需扩长），校验逻辑放在后端。
- `src/lib/constants.js` 里的 `ROLES` / `ROLE_META` 是旧「员工 / 管理员」模型的残留，新代码统一用 `admin_type`。
- `src/lib/cloudbase.js`、`initCloudBase()` 是 CloudBase 时代的**命名遗留**，实际是自建后端访问层 + Mock 兜底。
- Mock 模式（`VITE_USE_MOCK=true`）数据存在浏览器 localStorage，仅供本地调试，不要在正式环境开启。
- 目录下已无实际使用的 CloudBase 云函数 / 脚本；如需清理请另行确认后再删。

## License

MIT
