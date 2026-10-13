# 党员评价系统

> 基于 **React 18 + Vite 5 + Ant Design 5**，接入 **CloudBase**（数据库 + 静态托管），支持**党员自评、审核打分、Excel 导出**全流程。

## 功能

| 模块 | 说明 |
| --- | --- |
| 用户系统 | 注册 + 登录。员工注册时选择「岗位类型 → 岗位 + 所在党支部」，管理员注册时选择「所在党支部」 |
| 党员自评 | 多维度评分（政治素质 20 + 工作业绩 25 + 联系群众 15 + 纪律作风 20 + 先锋模范 20 = 100） |
| 审核评价 | 只审核**本人负责支部**的员工，查看自评内容（含岗位 / 类型 / 支部），给出最终分 + 审核评语，支持按年度/状态/姓名筛选 |
| 评价汇总 | 只汇总本支部数据，支持统计卡片、维度均值、删除（管理员）、一键导出 Excel（含岗位 / 类型列） |
| 角色权限 | 员工只能自评，管理员只审核/汇总/导出**本支部**数据，按支部隔离 |
| 数据后端 | 用户注册/登录走 **CloudBase 云函数 + PostgreSQL**（`user_table` 表）；评价数据走 CloudBase 数据库（`evaluations` 集合）；未配置时自动 Mock 到 localStorage |

## 快速开始（本地）

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务
npm run dev
# 浏览器访问 http://localhost:5173

# 3. 生产构建
npm run build
# 产物在 dist/ 目录
```

> 当前环境如未安装 Node.js，请先到 https://nodejs.org 下载 LTS 版本（≥18）。

## 角色与权限 / 两种工作模式

| 角色 | 登录后默认进入 | 可访问页面 | 说明 |
| --- | --- | --- | --- |
| 员工（党员） | `/self`（党员自评模式） | `党员自评` | 只能看自己的分数 + 提交自评；不能访问审核/汇总 |
| 管理员（支部） | `/review`（管理员审核模式） | `审核评价`、`评价汇总` | 含待审数量徽章；可审核打分、汇总、导出 Excel |

越权访问会**静默重定向**到自己角色的主页，不会显示错误页。

### 岗位类型 → 岗位（级联选择）

员工注册时**先选岗位类型，再选所在岗位**；岗位下拉的可选项由所选岗位类型决定。定义在 `src/lib/constants.js` 的 `POSITION_TYPES` / `POSITIONS_BY_TYPE`。

| 岗位类型 | 可选岗位 |
| --- | --- |
| 专业技术岗位党员 | 配网专业技术岗、营销专业技术岗、工程专业技术岗、综合事务岗 |
| 班组长岗位党员 | 营业班班长、大客户班班长、低压综合服务班班长、配电运检班班长、配电工程班班长 |
| 班组成员岗位党员 | 营业班班组成员、大客户班班组成员、低压综合服务班班组成员、配电运检班班组成员、配电工程班班组成员 |

> 切换岗位类型会自动清空已选岗位，避免类型与岗位不匹配。

### 所在党支部与「审核范围」隔离

员工与管理员注册时都必须选择所在党支部（**第一党支部 / 第二党支部**），定义在 `src/lib/constants.js` 的 `BRANCHES`。**同一个下拉字段，两种语义**：

| 角色 | 选择党支部的含义 | 系统行为 |
| --- | --- | --- |
| 员工 | 我**属于**哪个党支部 | 自评记录带上所属支部，供对应支部的管理员审核 |
| 管理员 | 我**负责审核**哪个党支部 | 登录后只看到、只审核该支部的员工 |

管理员的数据范围隔离体现在：

- **审核页面**：只列出本支部待审/已审核员工，统计卡也只统计本支部
- **评价汇总**：只汇总本支部数据，导出的 Excel 也只含本支部
- 顶部会明确提示「负责审核：第一党支部」

- 员工注册顺序：岗位类型 → 所在岗位 → **所在党支部**
- 管理员注册顺序：**所在党支部**
- 员工进入自评页时，「所在党支部」自动带入且只读

> 数据隔离目前在前端实现（`listEvaluations({ branch })`）。生产环境请在 CloudBase **安全规则 / 云函数**中按登录用户身份做同样的限制，避免前端被绕过。

### 自评模式（员工）进入后看到

- 顶部蓝色 banner：「党员自评模式」+ 姓名 + 岗位 / 岗位类型
- 当前年度未提交：空状态卡片引导提交
- 已提交待审核：展示「我的当前分数」+ 「等待管理员审核」徽章
- 已审核：右侧高亮金色卡片「最终审核结果」，含最终分 / 等级 / 审核人 / 评语；表单自动锁定

### 审核模式（管理员）进入后看到

- 顶部金色 banner：「管理员审核模式」+ 姓名 + **负责审核：第一党支部**
- 三张统计卡：本支部当前年度待审 / 已审核 / 当前列表
- 待审徽章（红点）：一眼看出还有多少条待办
- 表格默认筛选「待审核」，**只含本支部员工**，点击行在 Drawer 中给分 + 写评语

> 顶栏右侧的胶囊标签会动态显示当前模式（管理员审核模式 / 党员自评模式），方便区分当前账号身份。

## 用户数据存在哪

用户注册 / 登录走 **PostgreSQL 表 `user_table`**，链路是：

```
浏览器 → CloudBase 云函数 userService → PostgreSQL (user_table)
```

> 为什么不直连数据库：连接串含密码，写进前端等于公开。云函数里从**环境变量**读取，前端拿不到。

### 字段映射

| 前端字段 | 数据库列 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | `id` | uuid | 主键，`gen_random_uuid()` 自动生成，前端不传、不可改 |
| `username` | `user_id` | varchar(30) | 登录账号，**唯一** |
| `password` | `pw` | varchar(30) | 密码 |
| `role` | `admin` | boolean | `TRUE` = 管理员，`FALSE` = 员工 |
| `positionType` | `type` | varchar(20) | 管理员存 `NULL` |
| `position` | `job` | varchar(50) | 管理员存 `NULL` |
| `name` | `name` | varchar(100) | 中文姓名 |
| `branch` | `branch` | varchar(10) | `first` / `second` |

映射代码在 `src/lib/userService.js`，所以自评 / 审核 / 汇总等页面**完全不用改**。

### 重名怎么处理

注册时如果 `user_id` 已存在，数据库唯一索引会拒绝插入，云函数返回 `USER_EXISTS`，页面提示：

> **用户名已经存在，请选择一个新的用户名**

不会产生半条脏数据。前端在 `AuthContext.register()` 里还前置判断一次，保证提示及时。

⚠️ **前提**：表上必须有 `user_id` 的唯一约束，执行 `scripts/user-table.sql` 的第 3 步即可加上。

### 关于 `id`

`id` 由数据库 `DEFAULT gen_random_uuid()` 生成：128 位随机 uuid，不可枚举、不可猜测，注册流程**根本不传这个字段**，所以用户无从修改。

> 想改成「姓名首字母 + 日期」这种可读编号的话，uuid 列装不下，需要另加一列 `varchar`（例如 `user_no`），主键保持 uuid 更安全。

### 初始管理员

数据库里没有内置账号，需要手动插一条（`scripts/user-table.sql` 末尾有现成语句）：

```sql
INSERT INTO user_table (user_id, pw, admin, name, branch)
VALUES ('admin', 'admin123', TRUE, '默认管理员', 'first');
```

### 首次进入建议（体验支部隔离）

1. 执行上面的 SQL 建一个 `admin`（第一党支部）
2. 打开 `/register` 注册员工账号，**第一、第二党支部各注册一个**
3. 注册第二党支部的管理员（需要填写**第二党支部**自己的管理员密钥；两个支部密钥不通用，密钥在后端 `server/server.js` 的 `ADMIN_INVITE_CODES`，由后端校验）
4. 用员工账号登录 → `/self` 完成自评
5. 用 `admin` 登录 → `/review` 只看到第一党支部的员工
6. 换第二党支部管理员登录 → 只看到第二党支部的员工，两者互不可见

> 当前 `pw` 存的是**明文**（演示用）。上线前建议改成 bcrypt 哈希（把 `pw` 扩到 `varchar(60)`），并把密码校验逻辑迁到云函数内完成。

## 接入 CloudBase

### 1) 创建环境
- 登录 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) ，创建一个新环境（计费选「按量付费」即可）。
- 记下 **环境 ID**（形如 `your-env-id-1234567890`）。

### 2) 配置环境变量
复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

填入：

```
VITE_TCB_ENV=your-env-id-1234567890
VITE_USE_MOCK=false
```

### 3) 创建 PostgreSQL 用户表 + 部署云函数

**a. 建表 / 校正约束**

打开 CloudBase 控制台 → 数据库 → PostgreSQL → SQL 查询窗口，执行 `scripts/user-table.sql`。它会：

- 补上 `created_at` 列（云函数返回值里有它，缺了会报错）
- 给 `id` 加上 `DEFAULT gen_random_uuid()`
- 给 `user_id` 加**唯一约束**（重名检测靠它）
- 加 `branch` 取值约束、角色与岗位的一致性约束

**b. 配置云函数环境变量**

控制台 → 云函数 → `userService` → 函数配置 → 环境变量：

```
PG_CONNECTION_STRING = postgresql://用户名:密码@主机:5432/数据库名
PG_SSL               = true      # 仅当用公网地址连接时需要
```

> 连接串是**服务端密钥**，不要写进 `.env.local` 或任何前端文件。

**c. 部署云函数**

```bash
npm i -g @cloudbase/cli
tcb login
tcb fn deploy userService
```

`cloudbaserc.json` 里已配好 `installDependency: true`，云端会自动安装 `pg` 依赖。

**d. 前端切到真实模式**

`.env.local`：

```
VITE_TCB_ENV=lhr20000711-d0gfnvzhdf1b2802d
VITE_USE_MOCK=false
```

改完重启 `npm run dev`。

### 4) 初始化评价集合（evaluations）
执行一次性脚本（需先 `npm i -g @cloudbase/cli` 并 `tcb login`）：

```bash
TCB_ENV=your-env-id-1234567890 node scripts/init-db.js
```

脚本会创建 `evaluations` 集合并设置权限。完成后到控制台「数据库 -> evaluations -> 索引管理」手动创建索引：

```
索引名: idx_name_year
字段:   { name: 1, year: 1 }
唯一:   是
```

> 该索引保证同一党员同一年度只有一条自评记录。
> 注意：评价数据目前仍在**文档数据库**里。如果你也想迁到 PostgreSQL，可以照 `userService` 的模式再加一个云函数，前端只需改 `src/lib/cloudbase.js`。

### 5) 集合数据结构（`evaluations`）

```jsonc
{
  "_id": "auto",
  "name": "张三",                  // 党员姓名
  "partyBranch": "第一党支部",      // 党支部
  "year": 2026,                    // 评价年度
  "scores": {                      // 分项自评
    "politicalQuality": 18,
    "workPerformance": 22,
    "massContact": 13,
    "disciplineCompliance": 18,
    "innovation": 17
  },
  "selfTotal": 88,                 // 自评总分（自动计算）
  "reviewStatus": "pending",       // pending / reviewed
  "reviewerName": "李书记",
  "reviewScore": 90,
  "reviewComment": "表现突出，建议在...",
  "reviewedAt": "2026-10-10 12:00:00",
  "createdAt": "2026-10-09 10:00:00",
  "updatedAt": "2026-10-10 12:00:00"
}
```

### 6) 部署到静态托管

**方式 A：CloudBase CLI（推荐）**

```bash
# 安装 CLI
npm i -g @cloudbase/cli
tcb login

# 修改 cloudbaserc.json 中的 envId 为你的环境 ID
# 然后执行
tcb framework deploy
```

CLI 会自动构建（也可手动 `npm run build` 后）并把 `dist/` 上传到静态托管。

**方式 B：手动上传**

1. `npm run build` 生成 `dist/`
2. CloudBase 控制台 -> 静态网站托管 -> 上传文件，把 `dist/` 整个目录上传。
3. 在「基础配置」中把**默认首页**设为 `index.html`、**默认 404** 也设为 `index.html`（保证 SPA 路由刷新不 404）。

## 目录结构

```
party-evaluation/
├─ cloudbaserc.json          # CloudBase 部署配置（静态托管 + 云函数）
├─ index.html                # 入口 HTML
├─ package.json
├─ vite.config.js
├─ cloudfunctions/
│  └─ userService/           # 用户注册 / 登录云函数（pg 连 PostgreSQL）
│     ├─ index.js
│     └─ package.json
├─ scripts/
│  ├─ user-table.sql         # PostgreSQL 建表 / 约束校正
│  └─ init-db.js             # 文档数据库集合 / 权限初始化
├─ src/
│  ├─ App.jsx                # 路由 + 权限守卫
│  ├─ main.jsx               # 启动入口
│  ├─ styles.css
│  ├─ components/
│  │  └─ AppLayout.jsx       # 侧边栏布局
│  ├─ context/
│  │  └─ AuthContext.jsx     # 注册 / 登录 / 角色
│  ├─ lib/
│  │  ├─ userService.js      # 用户数据层（云函数调用 + 字段映射 + Mock）
│  │  ├─ cloudbase.js        # CloudBase SDK 封装（含 Mock 兜底）
│  │  ├─ excel.js            # Excel 导出
│  │  └─ constants.js        # 评分维度 / 等级 / 岗位 / 支部 / 管理员密钥
│  └─ pages/
│     ├─ Login.jsx
│     ├─ Register.jsx        # 注册（角色分流 + 管理员密钥）
│     ├─ SelfEvaluation.jsx  # 自评表单
│     ├─ Review.jsx          # 审核页面
│     └─ EvaluationList.jsx  # 汇总 + 导出
└─ README.md
```

## 安全规则建议（生产）

`scripts/init-db.js` 默认开的是「全员可读写」，仅用于内部试用。生产建议改为：

```js
// 仅管理员可读全部，党员本人可写自己的记录
{
  read: "auth.role == 'admin' || doc.name == auth.name",
  write: "auth.role in ['admin','reviewer'] || doc.name == auth.name"
}
```

并接入 CloudBase **用户管理 / 自定义登录** 做实名。

## License

MIT