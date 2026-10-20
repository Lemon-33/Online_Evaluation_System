# 党员评价系统

> **最后更新：2026-10-16**（含当日 4 项变更，见文末 §16 变更记录）
>
> 本文是**系统总览**：给第一次接手的人（或新 AI）讲清「这是什么、有哪些规则、代码在哪」。
> **部署步骤 / 审核关系维护 / 排错**请看另一份：**`部署与审核关系维护.md`**。
>
> 📌 **约定：页面上的灰色小字（`Text type="secondary"` 之类的说明文案）以「当前代码里的样子」为准。**
> 如果发现某个标题 / 卡片 / 弹窗**下面的说明文字没了**，那都是**我特意删掉的**——
> 按「空就留空、不加任何提示词」的口径（如「暂无数据」「（已注销）」「（本月无具体事宜）」这类都不要补回）。
> **不要恢复、也不要顺手补写**；新增功能同理，没有明确要求就不加说明文案。

- **前端**：React 18 + Vite 5 + Ant Design 5（`src/`）
- **后端**：Node + Express + SQLite（better-sqlite3），全部在 `server/server.js` 单文件，接口统一 `/api/*`
- **数据库**：SQLite 文件 `server/party.db`，**表结构由 `server.js` 启动时 `CREATE TABLE IF NOT EXISTS` 自建**（没有迁移脚本，改结构靠清库重建）

---

## 1. 两条业务线（务必先分清）

这是理解全系统的关键：**两条线的数据、评价人、范围规则完全独立，不要混用。**

| | 履职贡献（自评 → 审核） | 基础积分（别人评我） |
| --- | --- | --- |
| 数据表 | `evaluation`（按月，一人一月一条） | `rating`（按月）+ `credit`/`discipline`（按年） |
| 谁填 | 本人自评 | **不用本人填**，由组织委员 / 党总支书记以「扣分问卷」形式评分 |
| 满分 | 各项累加 | 100 分起扣 |
| 审核 | 有，审核人打分定稿 | 无（评分即结果） |
| 范围依据 | **`review_assignment` 表**（显式指派） | **角色 + 支部**（代码里算，不用表） |
| 关键常量 | `SELF_EVAL_TYPES = [1,3]` | `BASIC_RATING_TYPES = [1,3]` |

> 另外有「个人积分查询」（`scoreQuery`）：把基础分 + 履职贡献分 + 加分扣分汇总给人看，是**只读**功能，不产生新数据。

---

## 2. 身份模型（`admin_type`）

**所有人同一个登录入口、同一套界面**，只有菜单和数据范围按身份不同。身份**只由工号决定**，注册页不让用户选身份，**也不让用户选所在党支部**（两者都来自工号白名单）。

| admin_type | 身份 | 是否自评（履职贡献） | 岗位类型 | 侧边栏 |
| --- | --- | --- | --- | --- |
| 0 | 支部书记 | 否 | 可留空 | 履职贡献评价审核（**恒有**） |
| 1 | 组织委员 | **是** | **必填** | 自评 · 基础积分查看 · 积分查询 · 基础积分评价 · [有审核对象时] 审核 |
| 2 | 党总支书记 | 否 | 可留空 | 履职贡献评价审核（**恒有**）· 基础积分评价 |
| 3 | 普通党员 | **是** | **必填** | 自评 · 基础积分查看 · 积分查询 · [有审核对象时] 审核 |
| **4** | **分管领导** | 否 | 可留空 | 履职贡献评价审核（**恒有**）· 支部积分查询 |
| **9** | **系统管理员（隐藏）** | — | — | 不走侧边栏，用独立页 `/backdoor`，见 §6 |

常量定义在 `server/server.js`：`ADMIN_TYPE_LEADER=0 / ORGANIZER=1 / SECRETARY=2 / EMPLOYEE=3 / DIRECTOR=4 / SYSTEM=9`。
前端同名常量在 `src/lib/constants.js`。

---

## 3. 白名单（谁是谁）—— 身份唯一真源

**唯一真源：`server/admin-whitelist.mjs`**（前端不持有副本、不做校验）。文件导出 `WHITELIST` 数组 + `lookupWorkId(workId)`。

- 每条记录形如 `{ workId, name, branch, adminType, roleName? }`，其中 `name` / `branch`
  **取自《供服二中心党员信息表》**（2026-10-18 补录齐全）。
- 注册时后端按工号查这张表，**直接用表里登记的 `adminType` 与 `branch` 落库** ——
  注册页**没有「所在党支部」一栏**，支部由白名单决定（`POST /api/register` 忽略 body 里的 branch）。
  白名单里没登记支部的工号 → `BRANCH_NOT_IN_LIST`，宁报错也不让本人自己选。
- 匹配规则：`String(workId).toLowerCase()`（大小写不敏感）。
- **后写的覆盖先写的**（内部是 `Map.set` 循环），同一个工号写两遍不会报错 —— 增删时务必检查重复。

当前登记 **51 人**，全部为 11 位真实工号（旧的 `W-00xx` / `000001` 占位符已全部清除）：

| admin_type | 身份 | 人数 | 工号 |
| --- | --- | --- | --- |
| 0 | 支部书记 | 2 | `11102000637` `11100027736` |
| 1 | 组织委员 | 2 | `11100032550` `11100028373` |
| 2 | 党总支书记 | 2 | `11100022396` `11100019036` |
| 3 | 普通党员 | 43 | `11100026755` `11100012387` `11100001477` `11100009123` `11100014855` `11100027376` `11100026358` `11101002087` `11100027577` `11200004146` `11100028512` `11100029058` `11100029716` `11100032161` `11100032154` `11100032375` `11100032512` `11100034031` `11100034032` `11100034697` `11100035208` `11100035739` `11100035187` `11100012997` `11100012796` `11100012408` `11100017508` `11100017733` `11100017617` `11100004767` `11100017227` `11102000647` `11100031313` `11100031730` `11100032004` `11100032357` `11100032533` `11100032543` `11100034059` `11100034006` `11100034760` `11100035174` `11100035683` |
| **4** | **分管领导** | 2 | `11100016167` `11100028443`（2026-10-18 由支部书记类别移入） |

> ⚠️ **白名单只管「注册那一刻」**。改它对**已注册**的账号无效（已落库的 `admin_type` 不会变），要改请用「员工信息维护」或清库重注册。
> ✅ **新账号只能通过注册流进入**（2026-10-19 改）：「员工信息维护」已**取消新建功能**，
>    `POST /api/backdoor/users` 不再有 INSERT 分支 —— 哪怕是系统管理员也不能在工具里
>    "敲一个不存在的工号"就建号；走 `/api/register` 时由后端按工号白名单落库。
>    要把白名单上的某工号"激活"成账号：先确认 `admin-whitelist.mjs` 已登记 → 该员工
>    在登录页走注册流 → 落库后系统管理员进「员工信息维护」按需调 admin_type / 岗位 / 支部。

---

## 4. 权限矩阵

权限由**两处**决定，两者必须一致才不会出怪事：

- **后端 `server/server.js`**：谓词 + 数据范围 —— **真正的边界**，前端绕不过去。
- **前端 `src/context/AuthContext.jsx` 的 `can(action)`**：只控制菜单项与路由显隐。

`can()` 现行规则（`src/context/AuthContext.jsx`）：

| action | 返回 | 说明 |
| --- | --- | --- |
| `self` | `admin_type ∈ {1,3}` | 每月履职贡献自评 |
| `basicRatingView` | `admin_type ∈ {1,3}` | 基础积分评价详情（只读；2026-10-16 起不再常驻侧边栏，改由个人积分查询进入） |
| `review` | `支部书记(0) \|\| 党总支书记(2) \|\| 分管领导(4) \|\| hasReviewTargets` | 履职贡献评价审核 |
| `scoreQuery` | `admin_type ∈ {1,3}` | 个人积分查询 |
| `scoreSummary` | `admin_type ∈ {0,1,2}` | 支部积分汇总 |
| `branchScoreQuery` | `admin_type = 4` | 支部积分查询（分管领导；**复用**「支部积分汇总」页面） |
| `basicRating` / `deductRating` | `组织委员(1) \|\| 党总支书记(2)` | 基础积分评价 |
| `userAdmin` / `reviewAssign` / `formOverride` | `user.canXxx`（登录时后端下发） | 三个系统维护工具，见 §7 |
| `list` / `export` | — | **已下线**（见 §9），恒为 false |

> `hasReviewTargets` 是后端在登录/注册时下发的布尔字段 = `review_assignment` 里有没有指派给我。

---

## 5. 数据范围（后端强制，前端参数不可越权）

| 业务线 | 谁 | 能看到 / 能审谁 |
| --- | --- | --- |
| 履职贡献 | **所有人（含党总支书记）** | 自己（若能自评）**∪** `review_assignment` 里指派给我的人 |
| 基础积分 | 组织委员(1) | **本支部** `admin_type IN (1,3)`，**含自己** |
| 基础积分 | 党总支书记(2) | **全体** |
| 个人积分查询 | 1 / 3 | 只能查自己 |
| 个人积分查询 | 0 / 2 | 可查任意人（`can('scoreQuery')` 前端只对 1/3 开放入口，接口层仍放行） |
| 履职贡献 | 分管领导(4) | 同支部书记：`review_assignment` 里指派给我的人；**入口恒有**（未指派也能进，列表为空） |

### 5.1 「党总支书记不再等于全体」（2026-10-15 变更）

**旧逻辑**：党总支书记的履职贡献范围是「全体」，由 `admin_type=2` 在代码里特判。
**新逻辑**：**删掉了这个特判**。党总支书记的审核范围与其他人完全相同 —— 只看 `review_assignment`。

配套改动：

- 后端 `canViewEvaluation()` / `canReviewEvaluation()` 删除 `if (isSecretary(me)) return true;`；
- `GET /api/evaluations`、`GET /api/evaluations/unsubmitted` 删除「党总支书记→全体」分支；
- `withUserMeta.hasReviewTargets` 不再对党总支书记恒真；
- **但党总支书记仍然「恒有审核入口」**（`can('review')` 里保留 `isSecretary`）——
  即：**进得去审核页，但刚注册时列表是空的**，需要系统管理员在「审核关系维护」里指派人给他。

> 后端仍有 4 处 `isSecretary(me)` 特判，**都属于基础积分那条线**（`/api/ratings`、`/api/ratings/:id/review`、`/api/ratings/:id/extra-deduct-review`、个人积分查询），
> 那边的「党总支书记 = 全支部」**没有变**，别误删。

### 5.2 月度排名（个人积分查询内）

`/api/scores/monthly` 在返回分数的同时下发本人的月度名次，前端显示在「全支部月度排名」卡片。

**显示方式（2026-10-16 与年度排名统一）**：大字只写「第 X 名」，参与人数以**小字**提示在下方
（`支部共 N 人参与本月排名`）；本月未参与排名（有得分模块未审核）→ 大字 `--` + 小字「本月暂不参与排名」。

> ⚠️ **当前「卡片文案」与「后端口径」不一致（待定）**：卡片写「全**支部**」，
> 但 `computeMonthlyRank()` 取人是 `SELECT work_id FROM user_table WHERE admin_type IN (1,3)`，
> **没有 branch 条件** → 实际是跨支部一起排，卡片上的「共 N 人」是全部 45 人里的出分人数。
> 要名实相符：给 `computeMonthlyRank(year, month, myWorkId, branch)` 加 `AND branch = ?`
> （`user_table.branch` 存在且 `NOT NULL`），`/api/scores/monthly` 把本支部传进去。

- 计算函数：`server/server.js` 的 `computeMonthlyRank(year, month, myWorkId)`，**实时聚合、不落表**。
  分数本身已存在 `rating` / `evaluation` 里，再建一张表就是第 5 份副本，要解决同步问题，不值得。
- 口径与月度总分**严格一致**：只算 `reviewStatus='reviewed'`；履职贡献先 `capEval40`（> 40 按 40）；总分 = 基础积分 + 履职贡献。
- 参与范围：`admin_type IN (1,3)`（组织委员 + 普通党员 = 45 人），**当前不按支部过滤**。
  支部书记(0) / 党总支书记(2) / 分管领导(4) 不自评、没有分数，不参与；系统管理员(9) 不在内。
- **只有「基础积分 与 履职贡献 都已审核」的人才进榜**，`participants` 就是这些人的人数。
  任一模块未审核 → 该人没有完整分数，**既不进榜、也不计入排名总人数**，
  前端显示「您本月有得分模块还未通过审核，暂时没有排名」（代码位置：`src/pages/ScoreQuery.jsx` 的 `MonthlyView`，改文案时两处一起改）。
- 同分同名次，采用 **`RANK()` 语义（并列后跳号：1,1,3）**。
  想改成不跳号（1,1,2，即 `DENSE_RANK`）→ 把 `rank = i + 1` 改成 `rank = (rank || 0) + 1`。
- 返回字段：`rank`（`null` = 本人有模块未审核）、`participants`（两项均已审核的人数 = 排名总人数）、`totalMembers`（应参与评分总人数，前端当前未展示，留作后续扩展）。
### 5.3 年度总排名（个人积分查询 → 全年，2026-10-16 新增）

`GET /api/scores/annual/rank?year` → 按 token 身份返回**本人**在**全单位**的年度名次，卡片显示在全年视图右侧（原「支部年度总排名」占位已替换成真实数据）。

- **分数口径与「年度积分汇总」完全一致**（避免两处分数对不上）：
  基础积分（当年有记录月份的平均）+ 履职贡献（同上，先封顶 40）+ 年度专项加分（`credit.reviewScore`，无则 0）+ 年度红线扣分（`discipline.reviewScore`，无则 0）。
- **参与排名的人（= 分母）**：`admin_type IN (1,3)`（组织委员 + 普通党员），且当年
  **至少有一个月的基础积分记录 + 至少一个月的履职贡献记录**（两个模块各有一条即可，**不要求同一个月**）。
  任一模块全年都没有 → 既不进榜也不计入分母，卡片显示 `--` 并说明原因。
- 排名：**总分降序，同分并列且并列后跳号**（与月度排名的 `RANK` 语义一致）。
- **只下发本人名次 / 参与人数 / 本人四项分数**，不下发其他人的姓名与分数（员工端只看自己）；
  完整榜单走管理员的「支部积分汇总 → 年度积分汇总」。
- 实时算（`computeAnnualRank`），不建表、不缓存：4 条 SQL 取回全年记录后内存聚合，
  复杂度 O(人数 × 12 月)，几十人规模毫秒级，无需定时任务。

---

## 6. 系统管理员（隐藏账号）

| 项 | 值 |
| --- | --- |
| `user_id` | `__backdoor__` |
| `work_id` | `superadmin` |
| `admin_type` | `9` |
| 登录接口 | `POST /api/backdoor/login`（不是 `/api/login`） |
| 口令 | `server/.env` 里的 `BACKDOOR_PASSWORD_HASH`（scrypt 哈希，**不是明文**） |
| 前端入口 | `/backdoor`（独立布局，不走侧边栏，内部自检 `admin_type=9`） |

### 6.1 它是「懒创建」的

`server.js` 启动**不会**自动插入这条记录。它只在**第一次用 `superadmin` + 正确口令登录 `/api/backdoor/login` 时**才 `INSERT`。
→ **清库后第一次必须走后门登录口**，否则库里没有这个人，谁也进不去后台。

### 6.2 任何选人下拉 / 姓名查询都选不到它（2026-10-15 变更）

需求：**下拉框选姓名时不能出现系统管理员，手动输入它的名字也查不到。**
前端下拉是拿接口返回的数组做**本地匹配**，所以必须**前后端两头都堵**：

| 层 | 位置 | 做法 |
| --- | --- | --- |
| 后端 | `GET /api/backdoor/users` | SQL 加 `AND admin_type != 9 AND work_id COLLATE NOCASE != 'superadmin'` |
| 后端 | `GET /api/form-overrides/members` | 同上 |
| 后端 | `GET /api/evaluations/unsubmitted` | 同上（兜底，防它被误指派为被审对象） |
| 前端 | `src/pages/Backdoor.jsx` 姓名下拉 | `nameOptions` 过滤（`admin_type` 字段） |
| 前端 | `src/components/FormOverridePanel.jsx` | **在 `loadMembers()` 加载名单时就过滤**（含 `adminType` 字段），下拉框 + 手动输入解析 `resolveMember()` 一起堵死 |

> ⚠️ **两个接口字段口径不同，极易踩坑**：
> `GET /api/backdoor/users` 返回**未映射的原始行** → 用 `admin_type`；
> `GET /api/form-overrides/members` 后端做过 `rows.map()` → 用 **`adminType`**（驼峰）。
> 写错不会报错，但 `undefined !== 9` 恒为真 → **过滤静默失效**。

### 6.3 已知未处理

`POST /api/login`（普通登录口）**没有**阻止 `user_id='__backdoor__'`。
即：知道这个 user_id + 后门口令的人，仍可从普通登录口进去。需要时再封。

---

## 7. 三个系统维护工具（`permission` 表）

三个工具默认**对所有人隐藏**，由系统管理员在 `/backdoor` →「权限管理」页在线勾选授权。

| key | 名称 | 作用 |
| --- | --- | --- |
| `userAdmin` | 员工信息维护 | 改姓名 / 岗位 / 支部 / 密码、改身份（仅系统管理员）、改工号（仅系统管理员）、删除用户 |
| `reviewAssign` | 审核关系维护 | 指派谁审谁 |
| `formOverride` | 个人问卷维护 | 给个别员工定制履职贡献问卷 |

- 授权存在 **`permission` 表**（`work_id` + `tool`），**每次请求实时查库** → 收回后下一个请求即失效，**不用重启**。
- 工具清单唯一真源：`server/server.js` 的 `GRANTABLE_TOOLS`。
- 系统管理员(9) **恒拥有全部工具**，不在表里登记。
- 「权限管理」本身**不可授予**（硬校验 `admin_type=9`，不进 `GRANTABLE_TOOLS`）。
- 授权 / 收回后，**本人需重新登录**才会刷新侧边栏。
- 收紧规则（**2026-10-19 进一步收口**）：
  - **不再支持新建账号**（任何人，包括系统管理员）：新账号走 `/api/register` 注册流。
  - **改 `admin_type` 只有系统管理员(9) 能做**（撤销原「党总支书记」例外）。
  - **改 `work_id`（工号）只有系统管理员(9) 能做**：新工号不能撞别人，老工号那条记录的所有登录会话会被清。
  - 其它被授权账号能改的字段：姓名 / 岗位 / 岗位类型 / 支部 / 登录账号 / 密码 / 删除。

### 7.1 选人方式统一为「单框：姓名或工号」（2026-10-16 变更）

需要定位账号的地方现在都是**一个输入框**，与「权限管理」页同一套交互：

| 位置 | 组件 | 现在是 |
| --- | --- | --- |
| 员工信息维护 | `UserManagementTab`（`src/pages/Backdoor.jsx`） | 单框，输入姓名或工号 → 自动加载（**2026-10-19 起取消新建模式**，匹配不到只清空表单） |
| 个人问卷维护 | `FormOverridePanel`（`src/components/`） | 单框 → 点「调出问卷」 |
| 权限管理 | `PermissionTab` | 本来就是单框（这次的参照标准） |
| 审核关系维护 · 新增关系 | `ReviewAssignmentsTab` | **保持原样**：审核人 1 个工号 + 被审核人多个工号（文本域），本来就是要批量输工号，没改 |

- 三个被授权出去的侧边栏页（`/user-admin`、`/form-override`、`/review-assign`）
  **复用同一个组件**，没有复制代码 → 交互自动一致，**不存在"改了 backdoor 没改侧边栏"的情况**。
- **同名多人**：只敲姓名无法唯一确定 → 不自动加载。员工信息维护在框下给出
  「该姓名对应 N 人，请从下拉里按工号选择」；个人问卷维护点「调出问卷」时提示。
  下拉每项都是「工号　姓名」，按工号点选即可。
- 系统管理员(9) / `superadmin` 不在候选项里，敲全了也选不中（见 §6.2）。

### 7.2 两个筛选功能（2026-10-16 新增）

- **审核关系维护 → 现有审核关系**：两个输入框（审核人 / 被审核人）+「筛选」「重置」。
  输入文字后点「筛选」→ 只看某个审核人负责的全部被审核人，或某个被审核人是被谁审的。
  两个框都填 = 取交集。标题显示「筛选出 N 条 / 共 M 条」。
- **权限管理 → 已有特殊权限**：一个输入框（姓名）+「筛选」「重置」，
  输入姓名后点「筛选」→ 只看该账号拥有的全部特殊权限。

两者都是**纯前端过滤**（数据本来就一次性拉全了，51 人量级不需要后端分页），
且**按「点按钮」生效**、不是边打字边变，避免输入过程中列表抖动。
筛选时会清空表格勾选，防止「删除选中」误删看不见的行。

---

## 8. 审核关系（`review_assignment`）

「谁审谁」由这张表**显式**决定，代码**不做**任何按支部 / 岗位的自动匹配。

```sql
CREATE TABLE review_assignment (
  reviewer_work_id TEXT NOT NULL,   -- 审核人工号
  target_work_id   TEXT NOT NULL,   -- 被审核人工号
  created_at       TEXT DEFAULT (datetime('now','localtime')),
  is_second INTEGER NOT NULL DEFAULT 0,  -- 是否「第二审核人」（0=否 / 1=是），详见 §8.1
  PRIMARY KEY (reviewer_work_id, target_work_id)
);
```

### 8.1 「第二审核人」标记 `is_second`（2026-10-20 新增）

**界面**：「审核关系维护」（`/review-assign` 与 `/backdoor` 的同一 Tab）里，
「新增 / 追加 审核关系」表单的**保存按钮左边**有一个 `Switch`，标签「第二审核人」。

- **默认 false**（关闭）：只有管理员主动拨开，本次新增的关系才置 `is_second = 1`
- 保存成功后**开关自动复位为 false**（与表单其它字段一起回到初始态）
- 列表多一列「第二审核人」显示「是 / 否」，只读

**存量数据全部为 false**：`NOT NULL DEFAULT 0` + 启动时 `ALTER TABLE ... ADD COLUMN is_second INTEGER NOT NULL DEFAULT 0`，
SQLite 会把所有历史行一并填成 0，不需要额外 UPDATE。

**改标记不用删了重建** —— 这点很关键：`POST /api/backdoor/assignments` 用的是 upsert：

```sql
INSERT INTO review_assignment (reviewer_work_id, target_work_id, is_second)
VALUES (?, ?, ?)
ON CONFLICT(reviewer_work_id, target_work_id)
DO UPDATE SET is_second = excluded.is_second
```

只改 `is_second`、**绝不动 `created_at`**。因为 `created_at` 是「审核关系生效起始期」的依据
（见上面「只对建立当月及未来生效」），若走「先删再建」，新行 `created_at` 变成当时 →
起始期被推后 → **该审核人会丢掉对历史月份记录的可见性**。

> ⚠️ **2026-10-20 起已接通**：`is_second` 现在被「中心领导审核」审核分割规则使用，
> 详见 §8.2。

- **添加关系不要求工号已注册**（2026-10-16 改）：只要有工号就能建关系，
  未注册 / 已注销的工号在列表里**只显示工号、不显示姓名**（也不写「已注销」）。
  列表是**实时 `LEFT JOIN user_table`** → 该工号一旦注册，下次打开本页**自动显示姓名**，
  审核范围（`reviewTargetsOf`）也同时生效，不需要任何刷新 / 迁移动作。
  后端 `POST /api/backdoor/assignments` 只校验「工号非空」与「被审核人 ≠ 审核人」。
- **工号口径统一**（2026-10-16）：审核关系写入 / 删除都用 `normWorkId`（去空格 + 转大写），
  与注册落库一致；列表 JOIN 与 `reviewTargetsOf` 用 `COLLATE NOCASE`；
  启动时一次性规范化存量数据（`normalizeAssignmentWorkIds`）。
  否则「关系里存小写 + 账号是大写」会匹配不上：姓名不显示、审核列表为空。
- **一个被审核人可以有多行**（被多人审）。
- ⚠️ **「多人审」= 可见范围，不是多份独立评分**：`evaluation` 表 `UNIQUE(work_id, year, month)`，
  一人一月只有一行、只有**一组**审核字段（`reviewerName` / `reviewScore` / `reviewComment` / `reviewScores`），
  **没有** `reviewer_work_id` 列，也没有「审核意见明细表」。故两个审核人各自提交时
  **后提交者完全覆盖先提交者**（含审核人姓名），且没有任何并发 / 重复保护
  （前端 `src/pages/ReviewForm.jsx` 已明示「本次提交将覆盖上一次审核结果」）。
- **员工端能看出「被几个人审过」**：`evaluation.reviewers` 列（TEXT，存 JSON 数组
  `[{ workId, name, at }]`，**按 `work_id` 去重**）在每次 `PATCH /api/evaluations/:id/review` 时
  **累积**提交者名单；分数 / 意见 / 定稿答案仍走单一槽位被覆盖，本列只累积「谁来过」。
  老数据该列为 NULL → 员工端回落到原来的单行「审核人：X · 时间」显示。
  自评页「最终审核结果」卡片：名单 > 1 人时显示「审核人（N 位）：张三（…）、李四（…）」。
- ⚠️ **审核关系只对「建立当月及未来」生效，历史月份不追溯**：
  判定依据是 `review_assignment.created_at`（建表时就有，`datetime('now','localtime')`）。
  后端把年月折成「期」`periodOf(y,m) = y*12+m`，只放行 `记录期 >= 关系建立期` 的自评记录。
  这样**今天新增一条审核关系，被审核人历史月份的自评不会突然冒到审核人列表里**
  （即使前端把月份筛成「全年」也不会）。生效点：
  - `GET /api/evaluations`（列表）—— JS 里按 `reviewTargetFromPeriodsOf(me)` 过滤
  - **例外**：早于起始期、但 `evaluation.reviewers` 里有我工号的记录**始终保留**
    （管理员误删审核关系再补回来时，新行 `created_at` 是当时，不该丢掉我已审过的记录）
  - `canViewEvaluation` / `canReviewEvaluation` —— 拿到 id 直接访问也拦住（含 `PATCH /:id/review`、`DELETE /:id`）
  - `GET /api/evaluations/unsubmitted` —— 分母同步截断，避免「列表空但统计卡显示 N 人未提交」
  `created_at` 取不到（老库补列前 / 异常值）时回落 `0` = 不设限，不会误伤。
- ⚠️ **审核人的「待办」必须看 `myReviewStatus`，不能看 `reviewStatus`**：
  `reviewStatus` 是**记录级**的（这条卷子有没有被审过），一个被审核人有多个审核人时，
  甲审完会把乙的也标成 `reviewed` → 乙的「待审核」列表里就再也看不到这条记录。
  所以后端 `GET /api/evaluations`（`scope=assignments`）与 `GET /api/evaluations/:id`
  会额外下发**派生字段**（由 `reviewers` 列算出，**不落库**）：
  - `myReviewStatus`：`'reviewed'` = `reviewers` 里有我的工号（我审过）；`'pending'` = 我没审过
    （不管别人审没审）。不是我的审核对象时为 `null`（对员工无意义）。
  - `overriddenByOther`：我审过、但之后被别的审核人覆盖（`reviewers` 末项不是我）。
  审核人列表的**状态列 / 状态筛选 / 待审已审计数**全部改按 `myReviewStatus`，
  `reviewStatus` **语义不变**，继续服务员工端「自评已锁定」与积分汇总取审核分。
  **前端文案一字不改**，仍显示「已审核 / 待审核」。
  ⚠️ **只对当月及未来生效，历史月份不重新开启**：
  - 当月及未来：`reviewers` 为空 = 还没人审过，**一律判为「待审核」**，让每位审核人都过一遍
    （覆盖模式下重审无副作用）。
  - 历史月份（早于当前年月）且 `reviewers` 为空：沿用记录级 `reviewStatus`（已审就是已审），
    **不**把它们判成「待审核」重新冒到待办里；`reviewers` 已有值时照常按它派生。
- **所有审核人（含党总支书记）都要登记** —— 党总支书记不再自动兜底全体。
- `review_assignment` 里没有记录 → 该审核人**列表为空**（党总支书记除外：他有入口但列表空）。
- 改完关系后，**被指派者需重新登录**才会刷新菜单（`hasReviewTargets` 登录时下发）；后端放行是即时的。

维护 SQL 与批量指派见 **`部署与审核关系维护.md` §7**。

### 8.2 「中心领导审核」审核分割规则（2026-10-20 新增）

**场景**：被审核人的卷子里有一道「本题由中心领导审核」的题；按制度，该被审核人
**必须有 2 个审核人**：一个管这道题（**第二审核人**），一个管其余题目（**正常审核人**）。

**前提**：被审核人在「审核关系维护」里必须**正好**有两条 `review_assignment`，
且其中一条 `is_second=1`、另一条 `is_second=0`。

**关键词配置**：存放在 `app_settings.highlight_keyword`（key/value 全局表），
**默认** `本题由中心领导审核`。**只有系统管理员**可在「个人问卷维护」页修改
（被授权使用本页的其他用户看不到该区块、API 也 403）。留空 = 关闭规则，全员可编辑。

**匹配规则**：严格相等、区分大小写。`item.label === keyword` 才算命中。
匹配基数来源是 `evaluation.reviewScores.snapshot` 或 `evaluation.scores.snapshot`（哪个先有就用哪个），
因为服务端拿不到完整 `formDef`。

**行为**：

| 审核人 | 关键词题 | 非关键词题 |
|---|---|---|
| `is_second=1`（第二审核人） | ✅ 可编辑 | ❌ 置灰、提交时该格保持 reviewScores 原有值 |
| `is_second=0`（正常审核人） | ❌ 置灰、提交时该格保持 reviewScores 原有值 | ✅ 可编辑 |

**「原有状态」含义**：`evaluation.reviewScores.answers[key]` 当前是什么就保留什么：
- 对方已填 → 提交后**不被覆盖**（你提交时带上去的值会被服务端丢弃）
- 双方都没填过 → 保持空（**不会**回填员工自评的答案，因为扣分段员工本来也没填）

**实现要点**：

- 前端：`ReviewForm.jsx` 挂载时 GET `/api/settings/highlight-keyword`，结合 `rec.meIsSecond` 算 `isItemEditable(it)`，
  命中规则的题用 `InputNumber disabled / Radio.Group disabled / TextArea disabled` 置灰
- 后端：`PATCH /api/evaluations/:id/review` 用 `rec.meIsSecond + snapshot 中的关键词题 key` 做**强制过滤**，
  不可编辑的 key 不写入。**前端置灰只是 UI，后端是真校验**，避免改前端绕过
- 端点：`GET /api/settings/highlight-keyword`（登录即可）/ `PUT /api/settings/highlight-keyword`（`admin_type===9`）

**全局表** `app_settings`：单一真源，存所有「影响全局行为」的开关 / 关键字。
后续要加「年度开关 / 公示期起止 / 导出模板」等全局变量，直接加行不用改表结构。
seed 默认值用 `INSERT OR IGNORE` 注入（不覆盖管理员改过的值）。

---

## 9. 页面与路由

| 路由 | 页面 | 权限 key |
| --- | --- | --- |
| `/login`、`/register`、`/forgot` | 登录 / 注册 / 忘记密码 | 公开 |
| `/`、`*` | 按身份跳各自工作台（`homePath()`） | 登录 |
| `/self` | 每月履职贡献自评 | `self` |
| `/self-center` | 党员自我评价提交（提交类工作总入口，登录后默认页） | `selfCenter` |
| `/credit-apply` | 年度专项加分申报（本人，一年一次） | `selfCenter` |
| `/review`、`/review-form/:id` | 履职贡献评价审核 / 整页审核表单 | `review` |
| `/basic-rating` | 基础积分评价 | `basicRating` |
| `/basic-rating/deduct/:id` | 扣分问卷评分 | `deductRating` |
| `/basic-rating-view` | 基础积分评价详情（兼容旧链接，带年份+月历选月） | `basicRatingView` |
| `/basic-rating-view/:year/:month` | 基础积分评价详情（**锁定月份**，从个人积分查询进入；无月历） | `basicRatingView` |
| `/redline-review` | 年度红线扣分审核（列表） | `redline`（仅支部书记） |
| `/redline-review/:id` | 年度红线扣分问卷评分页 | `redline`（支部书记 / 党总支书记） |
| `/redline-view/:year` | 年度红线扣分详情（本人只读，从个人积分查询进入） | `scoreQuery` |
| `/credit-review` | 年度专项加分审核（列表） | `creditReview`（支部书记 / 党总支书记） |
| `/credit-review/:id` | 单条年度专项加分核定 | `creditReview` |
| `/score-query` | 个人积分查询 | `scoreQuery` |
| `/score-summary` | 支部积分汇总 | `scoreSummary` |
| `/branch-score-query` | 支部积分查询（分管领导，页面复用 `ScoreSummary`） | `branchScoreQuery` |
| `/profile` | 个人信息 | 登录即可 |
| `/backdoor` | 系统管理员维护台（独立布局） | 内部自检 `admin_type=9` |
| `/user-admin`、`/review-assign`、`/form-override` | 三个工具的独立页（复用 `/backdoor` 的 Tab 实现） | 对应 tool key |

**已下线（2026-10-15）**：`/list`「评价汇总」+ Excel 导出按钮。
原因：汇总口径要重做。路由已移除、`can('list')` / `can('export')` 恒 false；
**代码保留备用**：`src/pages/EvaluationList.jsx`、`src/lib/excel.js`。

越权访问会**静默重定向**回自己的工作台首屏（`RequireRole` → `homePath(user)`），不显示错误页。

### 9.1 年度红线扣分审核（支部书记，2026-10-16 新增）

**入口**：支部书记(`admin_type=0`) / 党总支书记(`admin_type=2`) 侧边栏「年度红线扣分审核」（`perm = redline`）。

**可见范围**
- 党总支书记 → **全部支部**（可跨支部审核，列表含所有人，党支部列区分）。
- 支部书记 → 仅**自己支部**。

**记录生成**（与 `rating` 同思路：惰性 + 兜底，幂等，`UNIQUE(work_id, year)` 保证不重复）：

| 触发时机 | 范围 |
| --- | --- |
| 任何人登录成功 | 本人所在支部「当年」（每年第一次登录即生成） |
| 服务启动 + 每 6 小时定时 | 所有支部「2026 → 当前年」（跨年自动生成新一年） |
| 打开列表接口 `GET /api/disciplines` | 所查年份、本支部 |
| 起始年 | `DISCIPLINE_START_YEAR = 2026`（早于此不生成；未来年不生成） |

被评对象：本支部内 `admin_type IN (1,3)`（组织委员 + 普通党员），**按支部独立生成**。

**题型**（`src/lib/redline-form.js`，共 10 题）：每题是「有无」选择题 + 具体事由框。

| # | 题干 | 选「有」 |
| --- | --- | --- |
| 1 | 党员因违反党章党规受到党纪政纪处分 | 扣 30 |
| 2 | 党员因违法犯罪行为受到处罚 | 扣 50 |
| 3 | 党员发生违反中央八项规定精神问题 | 扣 30 |
| 4 | 党员因违反公司各项规章制度受到处罚 | 扣 20 |
| 5 | 发生党员责任的安全责任事故 | 扣 30 |
| 6 | 党员负责的作业现场出现被上级公司查见通报的严重违章 | 扣 10 |
| 7 | 党员发生影响职工队伍稳定的言论散布、传播行为 | 扣 20 |
| 8 | 党员发生信访、上访事件 | 扣 20 |
| 9 | 党员发生较大不良影响的属于个人责任的供电服务投诉 | 扣 20 |
| 10 | 党员发生影响公司形象的行风、舆情事件 | 扣 20 |

> 需求原文第 5 条含两种不同分值（安全责任事故 30 / 严重违章 10），拆成了第 5、6 两道题，
> 否则一道题无法表达两种扣分额度。

**计分与落库**

- 答案形状 `answers[key] = { value: 'yes' | 'no', reason }`；选「有」才计分，**事由必填**（选「无」可留空）。
- `reviewScore` = Σ 选「有」的题的分值 → **≤ 0**（无扣分项为 0）。
- `scores` 存 `answers` + `snapshot`（题干 / 选项 / 分值 / 事由 / 该题扣分）+ `deduction` + `finalScore`。
- **不再采集整体扣分原因**：页面没有底部大文本框，`reviewComment` 固定写空串。
- 该分数会自动进入「个人积分查询 → 全年」的**年度红线总扣分**一项（`/api/scores/annual` 直接读本表）。

**接口**：`GET /api/disciplines?year&status&keyword`、`PATCH /api/disciplines/:id/review`（均限支部书记 / 党总支书记、限本支部）。

### 9.2 侧边栏排序（个人偏好，2026-10-16 新增）

**入口**：「个人信息」页底部「侧边栏排序」卡片（顶栏右上角点自己名字 → 个人信息）。

**规则**
- 只排**当前账号有权限看到**的模块；无权限的模块不出现、也不写入。
- 上移 / 下移调整 → 「保存顺序」；「恢复默认」= 保存空数组，回到 `MENU_ITEMS` 的默认顺序。
- 存服务端 `user_menu_order`（`work_id` 主键，`orders` 存 JSON key 数组），**换设备/换浏览器登录仍保留**。
- 保存后由 `AuthContext.setMenuOrder` 更新，侧边栏**立即生效**，不用刷新。
- **只影响显示顺序，与权限无关**：权限仍由 `adminType` + `permission` 表决定。
- 之后新增的模块没出现在 `orders` 里 → 前端 `sortMenuItems()` 自动把它排到末尾。

**菜单定义唯一来源**：`src/lib/menu.js`（`MENU_ITEMS`：key / perm / label / icon）。
侧边栏（`AppLayout`）与排序页（`Profile`）都从这里取，**新增模块只改这一个文件**。

**接口**：`GET /api/settings/menu-order`、`PUT /api/settings/menu-order`（登录即可读写自己那一行）。

### 9.3 年度专项加分审核（2026-10-16 新增）

**入口**：侧边栏「年度专项加分审核」（支部书记 / 党总支书记可见，排在年度红线扣分审核之后）。

**规则**
- 数据来自 `credit` 表（一人一年一条 `UNIQUE(work_id, year)`）。
- **不做惰性生成**：记录由本人申报产生 —— 当年没人申报，列表就是空的，
  显示「YYYY 年暂无待审核的专项加分记录」，不造空壳数据。
- 维度是**年度**（筛选只有年度 + 状态 + 姓名，没有月份），分数是**加分**（≥ 0）。
- 不限 `admin_type`：红线是自动给被评对象生成的所以过滤了类型，加分谁都可能申报，库里有谁就审谁。
- 可见范围（后端强制）：党总支书记 → 全部支部；支部书记 → 仅自己支部（列表与提交都校验）。
- 审核动作：进入单条审核页后，左栏就是那张申报卷子且**可编辑** —— 审核人可改
  「有 / 无」、次数与每题的具体事由（改过的题标「已修改」）；
  **核定加分按改后的卷子自动算出**（不手填数字，实时刷新）；
  末尾「审核意见」写入 `reviewComment`；按钮：未审核 → **提交审核意见**，已审核 → **更新审核意见**。
- 审核版答案存 `credit.reviewScores` 列（新增，启动时自动补列），**员工原始申报的 `scores` 不动**。
- 员工在「年度专项加分申报」页看到的是**审核后的卷子**（读 `reviewScores`）：
  被改过的题标「审核人修改」并给出「本人申报」对照，右侧显示核定加分与审核意见，表单锁定只读。
- 回显优先用落库 `snapshot`（题干 + 分值 + 答案 + 事由），以后调规则也按申报 / 审核时的样子显示。
- 已核定的分数直接进入 `/api/scores/annual` 的「年度专项加分」。
- 员工端的**申报页与查看入口暂未做**（申报功能上线后，审核页左侧「申报明细」会自动显示
  `credit.scores.items`：类别 / 级别 / 分值 / 事由）。

**接口**：`GET /api/credits?year&status&keyword`、`PATCH /api/credits/:id/review`
（均限支部书记 / 党总支书记，支部书记限本支部）。

### 9.4 年度专项加分申报（员工端，2026-10-16 新增）

**入口**：「党员自我评价提交」→「年度专项加分提交 → 进入提交」→ `/credit-apply`（**不上侧边栏**，一年一次）。

**页面**：与「每月履职贡献自评」同构（左 16 卷子 / 右 8 合计卡），差异是**没有月历**，顶部只有年份选项。

**题型（规则库在 `src/lib/credit-form.js`）**
- `bool`：规则里**不带**"每项 / 每次 / 每篇"的条款 → 「有无」选择 + 具体事由（选「有」必填）。
- `count`：规则里带"每项 / 每次 / 每篇"的条款 → 次数填空（0–20）+ 具体事由（次数 > 0 必填）。
- 同一条款含多个分档的（如"省级及以上 8 / 南京市 6 / 省公司 4 / 市公司 2"）**按档拆成多道题**
  （一道题没法表达多种分值，与红线问卷 r5/r6 的拆法一致）。
- 「同一事项获不同级别表彰以最高级别计分、不重复累加」是人为判断，系统不自动识别：
  该类顶部有提示，最终由审核人核定。
- 提交时落 `snapshot`（题干 + 分值 + 答案 + 事由）→ 以后调规则也能回放历史申报内容。

**状态流转**：未申报 → 提交（`PUT /api/credits/mine` upsert，`reviewStatus='pending'`）→
支部书记 / 党总支书记在「年度专项加分审核」列表看到 → 核定后 `reviewed`，申报页锁定只读；
已审核后员工不能再改（接口返回 `ALREADY_REVIEWED`），需审核人在审核页重新核定。

**接口**：`GET /api/credits/mine?year`、`PUT /api/credits/mine`（按 token 身份读写本人那一条，不做惰性生成）。

### 9.5 年度积分汇总（2026-10-16 新增）

**入口**：「支部积分汇总 → 年度积分汇总」Tab（组织委员 / 党总支书记 / 支部书记）。

**口径（后端 `GET /api/summary/annual?year&branch` 一次算好）**

| 列 | 来源 |
| --- | --- |
| 基础积分 | 当年**有基础积分记录的月份**的 `rating.reviewScore` **平均**（只算已审核，不按 12 个月摊薄） |
| 履职贡献积分 | 当年**有履职贡献记录的月份**的 `evaluation.reviewScore`（先封顶 40）**平均** |
| 年度专项加分 | `credit` 表当年 `reviewStatus='reviewed'` 的 `reviewScore`（无记录 / 未审核 = 0） |
| 年度红线扣分 | `discipline` 表当年 `reviewStatus='reviewed'` 的 `reviewScore`（无记录 / 未审核 = 0，通常为负） |
| 总分 | 上述四项相加 |

- 没记录的人照常出现在列表里（按 0 分计），**按总分降序排名**（同分并列、并列后跳号）。
- 筛选只有**年度**（无月份）+ **支部**：组织委员 / 党总支书记 / 支部书记**都可任选支部或全体**
  （2026-10-16 起组织委员不再被后端锁在本支部）。
- **具体事宜**（`buildAnnualMatters`）：只列**命中**的题 —— 是非题 = `题干 + 事由`（不带项数），
  填空题 = `题干 + 项数 + 事由`；题干优先取落库 snapshot；专项加分用**审核版** `reviewScores`。
- **具体事宜只有「年度专项加分」「年度红线扣分」两项**：基础 / 履职贡献是月度平均，
  年度汇总**不展开它们各月的明细**（后端也不再返回这些中间数据）。
- **空就留空**：没有具体事宜时表格单元格与弹窗里**都不写「无 / 暂无」等提示词**，直接空白
  （导出 Excel 同理，空字符串）。
- **「查看」弹窗**：四项分数 + 上述两项具体事宜
  （每月分数 + 该月具体事宜），因为这两项是月度平均来的。
- **导出 Excel**：`exportBranchAnnualSummaryToExcel` →
  `{year}年度供电服务二中心{支部}全体党员年度积分汇总.xlsx`；
  月度汇总的旧文件名（含月份）保持不变。

### 登录后落地页（`src/lib/constants.js` 的 `homePath()`）

| 身份 | 落地页 |
| --- | --- |
| 系统管理员(9) | `/backdoor` |
| 支部书记(0) / 党总支书记(2) / 分管领导(4) | `/review` |
| 组织委员(1) / 普通党员(3) | `/self-center`（党员自我评价提交） |

> ⚠️ 改 `homePath()` 要小心：`RequireRole` 无权时会跳回 `homePath(user)`，
> 如果某人无权访问自己的落地页，会**原地重定向死循环**。

---

## 10. 数据模型（9 张表，全部由 `server.js` 自建）

| 表 | 粒度 | 用途 |
| --- | --- | --- |
| `user_table` | 人 | 账号。`pw` 存 **scrypt 哈希**（非明文）；`work_id` 有 `COLLATE NOCASE` 唯一索引 |
| `evaluation` | 人 × 月 | 履职贡献自评。`UNIQUE(work_id, year, month)`，重复提交覆盖 |
| `rating` | 人 × 月 | 基础积分。`UNIQUE(work_id, year, month)` |
| `credit` | 人 × 年 | 个人荣誉。`UNIQUE(work_id, year)` |
| `discipline` | 人 × 年 | 年度红线扣分（支部书记审）。`UNIQUE(work_id, year)`，见 §9.1 |
| `session` | token | 登录会话，7 天有效，**持久化在库里**（重启不掉线） |
| `review_assignment` | 关系 | 谁审谁。`is_second INTEGER NOT NULL DEFAULT 0` = 该审核人是不是「第二审核人」（详见 §8.1） |
| `form_override` | 人 | 个人专属卷子。`form_def` 存**合并后的完整卷子**（不是差异补丁）；`position` 对不上自动失效 |
| `permission` | 授权 | 谁被开放了哪个工具。`work_id` 是 `COLLATE NOCASE` |
| `user_menu_order` | 人 | 侧边栏排序个人偏好（详见 §9.2）。`orders` 存 JSON 数组 |

**口令存储**：全库 `pw` 都是 scrypt 哈希（`scrypt$N$r$p$salt$hash`）。启动时会把残留的明文**就地哈希化**（一次性、幂等，日志里能看到 `已把 N 条明文口令就地哈希化`），老账号密码不变、登录方式不变。哈希带随机盐，所以**登录校验在应用层做，SQL 里没法等值匹配**。

**登录标识（2026-10-20）**：`POST /api/login` 的账号框可填 **`user_id`（登录账号）** 或 **`work_id`（工作证编号）**，任一都能登录。
服务端先按 `user_id` 精确查，查不到再按 `work_id` 查（`COLLATE NOCASE`，且与注册入库口径一致：`normWorkId()` 去首尾空格 + 转大写）。
请求体字段名 `username` / `user_id` 都接受（前端用 `user_id`）。
失败提示统一为「账号或密码错误」—— 不区分「字段不存在」还是「密码错」，避免被用来枚举工号。
`superadmin` **不走这条路**，它固定走后门接口 `/api/backdoor/login`（见 §6）。

---

## 11. 目录结构

```
├─ index.html
├─ package.json                 # 前端依赖（vite / antd / xlsx）
├─ vite.config.js               # 开发代理 / 构建配置
├─ README.md                    # ← 本文：系统总览
├─ 部署与审核关系维护.md          # 部署步骤 + 审核关系维护 SQL + 排错
├─ server/                      # 后端（Express + SQLite）
│  ├─ server.js                 # 单文件：建表 + 接口 + 谓词 + 数据范围（~2200 行）
│  ├─ admin-whitelist.mjs       # 工号白名单（身份唯一真源）
│  ├─ hash-password.mjs         # 生成 scrypt 哈希的小工具
│  ├─ package.json
│  ├─ .env                      # ⚠️ 必需，不进 git：BACKDOOR_PASSWORD_HASH 等
│  └─ party.db                  # 运行时自动生成（勿提交）
└─ src/
   ├─ App.jsx                   # 路由 + 权限守卫
   ├─ main.jsx
   ├─ styles.css
   ├─ components/
   │  ├─ AppLayout.jsx          # 侧边栏 + 顶栏
   │  ├─ FormOverridePanel.jsx  # 个人问卷维护（选人 + 定制卷子）
   │  └─ ...
   ├─ context/AuthContext.jsx   # 注册 / 登录 / can() 权限矩阵
   ├─ lib/
   │  ├─ cloudbase.js           # 前端数据访问层（fetch + Bearer token + Mock 兜底）
   │  ├─ userService.js         # 注册 / 登录 / 字段映射
   │  ├─ constants.js           # 身份常量 / 岗位 / 支部 / 落地页
   │  ├─ forms-data.mjs         # 履职贡献表单数据
   │  ├─ deduction-form.js      # 基础积分扣分问卷定义与算分
   │  └─ excel.js               # Excel 导出（当前随汇总页一起下线，保留备用）
   └─ pages/                    # Login / Register / ForgotPassword / SelfEvaluation /
                                # Review / ReviewForm / BasicRating / DeductionRating /
                                # BasicRatingView / ScoreQuery / Profile / Backdoor /
                                # UserAdmin / ReviewAssign / FormOverride /
                                # EvaluationList（已下线，保留备用）
```

---

## 12. 本地运行

**后端**：

```bash
cd server
npm install
node server.js          # 监听 0.0.0.0:3000（PORT 常量，写死在 server.js:19）
```

**前端**：

```bash
npm install
npm run dev             # http://localhost:5173，/api 反代到 VITE_PROXY_TARGET
npm run build           # 产物在 dist/
```

前端环境变量（`.env.local`，全部可选）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 空 | 留空 = 同域直接请求 `/api/*` |
| `VITE_PROXY_TARGET` | `http://124.220.236.13` | 本地开发时 `/api` 反代目标 |
| `VITE_PUBLIC_BASE` | `/` | 静态资源前缀 |
| `VITE_USE_MOCK` | 未设 | `true` = 前端降级到 localStorage，不连后端（仅供调试） |

后端环境变量（`server/.env`，**必需项见 `部署与审核关系维护.md` §3**）。

> 生产环境是**同一台 Express 同时托管前端静态文件**（`DIST = path.join(__dirname,'dist')`）和 `/api`，天然同源，不需要配 CORS。

---

## 13. 岗位类型 → 岗位（级联）

注册时**先选岗位类型，再选岗位**；切换类型自动清空已选岗位。
定义在 `src/lib/constants.js` 的 `POSITION_TYPES` / `POSITIONS_BY_TYPE`。

| 岗位类型 | value | 可选岗位 |
| --- | --- | --- |
| 专业技术岗位党员 | `professional` | 配网专业技术岗、营销专业技术岗、工程专业技术岗、综合事务岗 |
| 班组长岗位党员 | `teamLeader` | 营业班班长、大客户班班长、低压综合服务班班长、配电运检班班长、配电工程班班长 |
| 班组成员岗位党员 | `teamMember` | 营业班班组成员、大客户班班组成员、低压综合服务班班组成员、配电运检班班组成员、配电工程班班组成员 |

> 组织委员(1) / 普通党员(3) **必填**；支部书记(0) / 党总支书记(2) / 分管领导(4) 可留空。
> 是否必填由**后端**按工号判定（留空返回 `POSITION_REQUIRED`），前端不做预校验。

## 14. 所在党支部（`branch`）

`BRANCHES` = 第一党支部 / 第二党支部（`src/lib/constants.js`，落库值 `first` / `second`）。

**唯一写入口 = 注册时的白名单**（2026-10-18 起）：注册页不再让用户选支部，
后端按「工作证编号 → `server/admin-whitelist.mjs`」取 `branch` 落库。
需要改动某个人的支部：先改白名单，再用系统管理员的「员工信息维护」改该账号（或清库重注册）。

| 身份 | 含义 | 作用 |
| --- | --- | --- |
| 普通党员(3) / 组织委员(1) | 我**属于**哪个支部 | 自评记录带上所属支部 |
| 组织委员(1) | 我**负责评价**哪个支部 | 基础积分范围 = 本支部 `admin_type IN (1,3)`（含自己） |
| 党总支书记(2) | — | 基础积分可见全体；**履职贡献不再全体**（见 §5.1） |

---

## 15. UI 规范：列表（表格）内容一律居中

> 这是**全项目统一约定**，新开发的任何页面 / 任何列表都要遵守。

**适用范围**：所有 `antd Table` —— 表头、数据单元格、合计行（`Table.Summary`）。

**规则**

1. **每一列都写 `align: 'center'`**：antd 的 `align` 同时作用于表头和单元格，写一次即可，
   不要出现「表头居中、内容靠左」或「内容居中、表头靠左」。
2. **数字列（分数、总分、统计值）一律 center**，不用 `align: 'right'`。
3. **操作列同样居中**（按钮 / 链接 / `Popconfirm` 触发的按钮）。
4. **合计行** `Table.Summary.Cell` 也要加 `align="center"`，否则汇总行会歪。
5. **单元格内容是多行结构**（如 `<Space direction="vertical">` 姓名 + 工号）时，
   给容器加 `style={{ width: '100%' }}`，两行文字才会都在格子正中。
6. **长文本列**（如「具体事宜」）在列表里只显示条数 / 摘要（如「共 3 项」），
   完整内容放「查看」弹窗里；该列保持紧凑宽度并居中。

**已按此规范处理的表格**（新增/修改时照抄即可）：

| 文件 | 列表 |
| --- | --- |
| `src/pages/Review.jsx` | 履职贡献审核列表 |
| `src/pages/BasicRating.jsx` | 基础积分评分列表 |
| `src/pages/EvaluationList.jsx` | 评价汇总列表（含合计行） |
| `src/pages/ScoreSummary.jsx` | 支部积分汇总列表 |
| `src/pages/Backdoor.jsx` | 审核关系维护、权限管理列表 |

**列宽分配**（同上原则）：每列给一个「刚好放得下」的基础宽度，
表格剩余空间**平均**加给每一列，不要单独让某一列（如岗位列）吸收全部剩余空间。
参考实现见 `ScoreSummary.jsx` 的 `COL_BASE_WIDTHS` / `colW()`。

### 15.1 移动端（窄屏）适配（2026-10-19 新增）

**口径：只按视口宽度判断，不做 UA 嗅探。** 需求是「电脑上保持原样、手机上优化布局」，
这本质是宽度问题；用 UA 会把 iPad、电脑窄窗口误判成手机，且无法响应旋转 / 窗口缩放。

**唯一真源：`src/lib/useIsMobile.js`**（`Grid.useBreakpoint()`，与 antd `Col` 的
`xs/sm/lg` 同一套断点）。判定 = `screens.md === false`，即**视口 < 768px**。

> ⚠️ **必须写 `screens.md === false`，不能写 `!screens.md`**：
> 首帧 `useBreakpoint()` 可能返回空对象，`!undefined === true` 会让桌面端先渲染一帧
> 手机布局（闪一下）再跳回桌面布局。

**桌面端（`≥ 768px`）保证逐像素不变的做法**：`span={16} xs={24} md={16}` ——
补 `xs` 的同时**必须补一个 `md` 把桌面值还原**。

> ⚠️ **antd 栅格是「移动优先」，`xs` 不带媒体查询**（`node_modules/antd/es/grid/style/index.js`
> 里 `genGridStyle(gridToken, '-xs')` 紧跟在 `span` 之后生成，只有 `sm`/`md`/`lg`/`xl`/`xxl`
> 才包 `@media (min-width: …)`）。所以：
> - `span={16} xs={24}` → **桌面端也变成 24**（`.ant-col-xs-24` 无条件覆盖 `.ant-col-16`）❌
> - `sm` / `md` / `lg` 是 `min-width`，**向上生效**：`sm={24}` 在桌面端同样命中 ❌
>
> 因此凡是动了 `xs`，就必须用 `md`（= 768px，与 `useIsMobile` 同一阈值）把 `span` 的原值写回来。

已适配项：

| 位置 | 窄屏表现 |
| --- | --- |
| `AppLayout.jsx` | 侧边栏折叠（< 992px）时顶栏出现菜单按钮 → `Drawer` 打开**同一份**菜单（原来折叠后完全没入口）；内边距 16/24 → 8/12；顶栏隐藏身份 Tag 与副标题 |
| `Review` / `BasicRating` / `RedlineReview` / `CreditReview` | 表格加 `scroll={{ x: 'max-content' }}`（仅窄屏），不再把整页撑出横向滚条；统计卡 `span={8}` → `xs={24} sm={12}` |
| 自评 / 审核 / 申报类页（`SelfEvaluation` `ReviewForm` `CreditApply` `CreditReviewForm` `RedlineRating` `RedlineView` `DeductionRating` `BasicRatingView`） | 「左 16 右 8」双栏窄屏堆叠成上下；通用 5 项表单 `6/12/6` 窄屏竖排 |
| `ScoreSummary.jsx` | 详情弹窗宽度 `720/760` → `92vw`；`Descriptions` 两列 → 单列 |
| `styles.css` | `.login-card` 定宽 `420px` → `min(420px, 92vw)` |
| `SelfEvaluation.jsx` | 窄屏右栏（月历 / 最终审核结果）加 `order: -1` 提到**表单上方**；「我的自评总分」「提交」抽出为 `bottomCards`，窄屏放到**表单末尾**（提交按钮不能跟着提到上面） |

**未适配**（按设计不在手机上用）：`/backdoor` 维护台、`FormOverridePanel`、`EvaluationList`（已下线）。

---

## 16. 已知遗留 / 待办

- `POST /api/login` 未阻止 `user_id='__backdoor__'`（见 §6.3）。
- `src/lib/constants.js` 的 `ROLES` / `ROLE_META` 是旧「员工 / 管理员」模型残留，新代码统一用 `admin_type`。
- `src/lib/cloudbase.js`、`initCloudBase()` 是 CloudBase 时代的**命名遗留**，实际是自建后端访问层 + Mock 兜底。
- Mock 模式数据存浏览器 localStorage，**不要在正式环境开启**。
- 评价汇总 / 导出口径待重做（页面与 `excel.js` 保留备用）。
- 白名单仍是**代码里的文件**而不是数据库表 —— 改一个工号要走完整部署流程，且**漏传该文件会导致整站起不来**（见部署文档 §5）。已评估过迁库方案，未实施。

---

## 17. 变更记录

### 2026-10-19

1. **审核人视图改用「我的审核状态」`myReviewStatus`**（修掉「甲审完、乙就看不到待办」的问题）：
   后端由 `evaluation.reviewers` 列派生 `myReviewStatus` / `overriddenByOther` 两个字段（**不落库**），
   `scope=assignments` 下的 `status` 过滤也改按它过滤；`Review.jsx` 的状态列 / 筛选 / 计数、
   `ReviewForm.jsx` 的顶部提示全部改用新语义。**前端文案保持「已审核 / 待审核」不变**，
   老数据（`reviewers` 为空）一律判为「待审核」；被他人覆盖时额外提示「已被他人更新」。
   记录级 `reviewStatus` **语义不变**，员工端与积分汇总零改动。详见 §8。
2. **自评页窄屏把「提交月历」「最终审核结果」提到表单上方**：`SelfEvaluation.jsx` 右栏在窄屏
   加 `order: -1`；「我的自评总分」「提交」两卡抽出为 `bottomCards`，窄屏改放**表单末尾**
   （提交按钮留在最下面才顺手），桌面端仍在右栏原位。
3. **移动端（窄屏）适配**（详见 §15.1）：新增 `src/lib/useIsMobile.js`（按视口宽度 < 768px 判定，
   不做 UA 嗅探）；侧边栏折叠时改用顶栏按钮 + `Drawer` 打开同一份菜单；4 个列表页表格窄屏横向滚动；
   自评 / 审核类双栏窄屏堆叠；登录卡片与弹窗宽度自适应。**桌面端（≥ 992px）逐像素不变**。
2. **员工端可看出「被几位审核人审过」**（`evaluation` 加一列 `reviewers`，不大改表）：
   `PATCH /api/evaluations/:id/review` 累积审核人名单（按 `work_id` 去重），
   `GET /api/evaluations` 与 `/api/evaluations/:id` 用 `parseJsonArray` 下发；
   自评页「最终审核结果」卡片在多于 1 位时显示「审核人（N 位）：张三（…）、李四（…）」。
   **不改**现行「互相覆盖」模式 —— 被覆盖的仍是分数 / 意见 / 定稿答案。
3. **分管领导新增侧边栏「支部积分查询」**（`/branch-score-query`）：
   权限 `branchScoreQuery` = 仅 `admin_type=4`；页面**复用** `src/pages/ScoreSummary.jsx`
   （只是标题与路由不同），月度 / 年度两个 Tab 与「支部积分汇总」完全一致，
   支部筛选可在**第一党支部 / 第二党支部 / 全体成员**之间任选。
   后端 `GET /api/summary/monthly`、`GET /api/summary/annual` 的鉴权加上 `isDirector(me)`。

### 2026-10-16

> ⚠️ **约定（改题相关代码必读）**：`formDefFromSnapshot` 与 `deductionFormDefFromSnapshot`
> **都返回 `{ sections: [...] }`**，取题组必须写 `formDef.sections`。
> 少写这一层不会报错（对象是 truthy），只会在后面 `.map` / `.flatMap` 时炸 —— 本日第 4 条就是这么踩的。

1. **个人积分查询新增全支部月度排名**（详见 §5.2）：显示「第 X 名 / 共 N 人」，实时聚合不建表。
   参与门槛为「基础积分 + 履职贡献两项都已审核」，总人数即为此人数；任一模块未审核则显示
   「您本月尚有得分模块还未通过审核，暂时没有排名」。
2. **员工信息维护 / 个人问卷维护：双框（姓名 + 工号）改为单框（姓名或工号）**，与权限管理一致。
   授权出去的 `/user-admin`、`/form-override` 复用同一组件，自动一致（详见 §7.1）。
3. **审核关系维护 / 权限管理新增筛选**（详见 §7.2）：前者按审核人 / 被审核人筛，后者按姓名筛已有特殊权限。
4. **修复「基础积分查看」白屏**（`h.flatMap is not a function`）：
   组织委员评分完成后，普通党员点开该月记录即崩。
   根因：`deductionFormDefFromSnapshot()` 返回 **formDef 形状 `{ sections: [...] }`**，
   而 `BasicRatingView.jsx` / `DeductionRating.jsx` 把它直接当「题组数组」用 → 对象没有 `.flatMap`。
   **未评分时 snapshot 为空 → 回落 `DEDUCTION_SECTIONS`（真数组）→ 不崩**，所以只在「审核完成后」复现。
   修法：两处调用点统一取 `.sections`，并对 `sections` / `sec.items` 加 `Array.isArray` 兜底。
5. **新增「年度红线扣分审核」模块**（支部书记，详见 §9.1）：
   侧边栏新入口 + `/redline-review`（列表）与 `/redline-review/:id`（问卷评分页），样式仿「基础积分评价」。
   复用已存在的 `discipline` 表（人 × 年）；记录由登录 / 启动 / 每 6 小时定时 / 打开列表惰性生成，
   只生成本支部 `admin_type IN (1,3)` 的人；10 道「有无 + 事由」题，选「有」按题面分值累计扣分，
   `reviewScore` ≤ 0，页面不再采集整体扣分原因（`reviewComment` 写空串）。
6. **列表（表格）内容统一居中**（详见 §15，已写入 UI 规范）：
   5 处表格（履职贡献审核、基础积分评分、评价汇总、支部积分汇总、后门两个维护列表）
   的每一列都加上 `align: 'center'`（含表头、操作列、合计行）；
   数字列由 `right` 改为 `center`。以后新增列表一律按 §15 执行。
7. **年度红线扣分审核开放给党总支书记**：`redline` 权限 = 支部书记 + 党总支书记（各自只审自己支部）；
   菜单固定为侧边栏**最后一栏**。
8. **支部积分汇总支持切换支部**：筛选框（第一 / 第二党支部 / 全体成员）放在年份月份之后；
   该模块同时开放给党总支书记与支部书记（**2026-10-16 补充：组织委员也可自由切换支部 / 看全体**，
   前端不再置灰、后端不再强制改回本支部）。
   选「全体成员」时列表多一列「党支部」，导出文件也多该列且文件名不带支部名。
9. **个人信息页新增「侧边栏排序」**（详见 §9.2）：用户可自定义自己侧边栏各模块的排列顺序，
   存服务端 `user_menu_order`（按工号一人一行），换设备登录仍保留；保存后立即生效。
   菜单定义统一收在 `src/lib/menu.js`（新增模块只改这一处）。
10. **「基础积分评价查看」不再常驻侧边栏，并入「个人积分查询」**：
    常驻时组织委员还没评分 → 员工看到一个空表单，体验差。改为在个人积分查询选好某月后，
    在「当月基础积分」卡片下方点**「查看评价」**跳 `/basic-rating-view/:year/:month`
    （年度视图不加该入口，年度是汇总口径没有单月卷子）。
    该页在锁定月份时隐藏年份切换与月历，只保留**卷子 + 分数**，顶部给「返回个人积分查询」；
    不带参数的旧路由 `/basic-rating-view` 已删除（测试期没有老用户）。
11. **年度红线扣分也可「查看评价」**：全年视图「年度红线扣分」卡片下方同样有**「查看评价」**，
    跳 `/redline-view/:year`，只读显示该年度 `discipline` 表的卷子
    （每题「有 / 无」+ 具体事由 + 该题扣分，命中红色高亮、未命中淡灰），
    右侧「扣分合计 / 命中事项 N/10」卡；样式与「基础积分评价详情」一致。
    新增后端 `GET /api/disciplines/mine?year`：**按 token 里的 work_id 强制取自己那一条**，
    任何登录用户都能调，无越权可能；本人支部当年未生成时顺带惰性补齐。
12. **组织委员 / 普通党员默认落地页改为「个人积分查询」**（`homePath()`：两类身份都进 `/score-query`）。
    「当月履职贡献积分」卡片下方新增自评入口，文案随当月状态变化：
    无记录 → **提交自评**；已提交待审核 → **修改自评**；已审核 → **查看评价**。
    点击统一跳 `/self` 并带上当前所查的年月（`nav('/self', { state: { year, month } })`），
    自评页按传入的年月打开（不传则仍是当前月）。
    全年视图「年度专项加分」卡下方同理：按 `credit` 表当年记录状态给
    **提交申请**（无记录）/ **更新申请**（待审核）/ **查看评价**（已审核），
    跳 `/credit-apply` 并带 `year`。
13. **年度专项加分审核**（详见 §9.3）：支部书记 / 党总支书记的审核模块，数据来自 `credit` 表。
    与红线审核同构，差异：**不做惰性生成**（谁申报审谁，当年没人申报就是空列表）、
    维度是年度（无月份）、分数是加分（≥ 0）。员工端的申报 / 查看入口暂未做。
14. **侧边栏新增「党员自我评价提交」**（`/self-center`，普通党员 / 组织委员可见，排第一位，
    登录后默认进这里）：页内两张卡 ——
    ① **履职贡献自评提交** → 跳 `/self`（带当前年月，已上线）；
    ② **年度专项加分提交** → 页面未做，按钮**置灰不可点**并提示「功能开发中，暂未开放申报」。
    做这个总入口是为了不让「一年一次」的申报常驻侧边栏（详见 §9.3 的设计取舍）。
22. **「员工信息维护」收口为只改不改建**（2026-10-19）：
    - **取消新建账号功能**（任何人，包括系统管理员）—— `POST /api/backdoor/users` 去掉 INSERT 分支。
    - 新账号一律走 `/api/register` 注册流（`admin-whitelist.mjs` 准入；与之前一致）。
    - **改 `admin_type` 收口到仅系统管理员(9)**（撤销原「党总支书记(2)」例外）。
    - **改 `work_id`（工号）仅系统管理员(9) 可改**：前端表单里工号 Input 始终可编辑，
      后端按 `originalWorkId` 定位行 + 新工号落库；新工号不能与他人重复，撞了 → `WORK_ID_CONFLICT`。
    - 其它被授权账号仍可改姓名 / 岗位 / 岗位类型 / 支部 / 登录账号 / 密码 / 删除。
20. **审核关系放宽**：添加审核关系**不再要求工号已注册**，未注册的工号也能建关系；
    列表里查不到姓名就只显示工号（原「（已注销）」提示去掉）。
19. **年度总排名（全单位）**（个人积分查询 → 全年，详见 §5.3）：实时算、不建表，
    分数口径与「年度积分汇总」一致；分母 = 当年**各有至少一个月**基础积分 + 履职贡献记录的人；
    员工端只显示本人「第 X 名 / 共 N 人」。
18. **人名统一黑色显示**：各页顶部身份条里的人名原本按身份配色（管理员模式红色、员工页蓝色），
    现在一律改黑色 `<Tag color="default" style={{ color: '#000' }}>`，涉及审核页 / 自评页 /
    申报页 / 基础积分评分 / 红线页 / 后门工具等 11 处。身份标签（支部书记 / 系统管理员等）配色不变。
17. **年度积分汇总**（支部积分汇总 → 第二个 Tab，2026-10-16 新增）详见 §9.5：
    年度口径的汇总表（基础 / 履职贡献取当年有记录月份的**平均分**，专项加分取 `credit.reviewScore`，
    红线扣分取 `discipline.reviewScore`），按总分排名、可筛支部、可导出 Excel，
    「查看」弹窗里看全部具体事宜（是非题 = 题干 + 事由，填空题 = 题干 + 项数 + 事由）。
16. **填空题交互统一**（自评页 / 履职贡献审核页 / 年度专项加分申报页）：
    **数量为 0 时不显示原因框**，填了数量（> 0）才出现，且此时原因**必填**；
    数量改回 0 时原因框自动隐藏，提交前会把这类残留原因清空，不留"有数量、没事由"的脏数据。
    （模式先在年度专项加分申报页用，反馈好 → 回移到履职贡献的卷子里）
15. **年度专项加分申报页**（`/credit-apply`，详见 §9.4）：按业务给定的四类加分规则做成申报卷，
    「有无 + 事由」与「次数 + 事由」两种题型，多分档条款按档拆题；顶部只选年度（无月历），
    右侧实时显示自报合计。申报后由支部书记 / 党总支书记在 §9.3 的审核模块核定。

### 2026-10-15

1. **白名单换成真实花名册**：`W-0001~W-0048`、`000001/000002` 全部作废，改为 51 个 11 位真实工号（4 支部书记 + 2 委员 + 2 党总支书记 + 43 普通党员）。
2. **系统管理员全链路隐藏**：任何选人下拉、手动输入姓名查询都选不到它（后端 3 个名单接口 + 前端 2 处过滤）。
3. **党总支书记不再「审全体」**：删除 `admin_type=2` 的全体特判，审核范围改由 `review_assignment` 决定；**但保留「恒有审核入口」**。
4. **评价汇总 / 导出入口下线**：移除路由 `/list`，`can('list')`/`can('export')` 恒 false；代码保留备用。

---

## License

MIT
