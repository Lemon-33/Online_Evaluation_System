-- ============================================================
-- user_table 结构校正脚本
-- 在 CloudBase 控制台 → 数据库 → PostgreSQL → SQL 查询窗口里执行
-- ============================================================

-- ------------------------------------------------------------
-- 1) 补上 created_at（云函数返回字段里有它，缺了会报列不存在）
-- ------------------------------------------------------------
ALTER TABLE user_table
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 2) 主键 id 自动生成 uuid
--    PG 13+ 内置 gen_random_uuid()，不需要 pgcrypto 扩展
--    旧版本请先执行：CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- ------------------------------------------------------------
ALTER TABLE user_table
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ------------------------------------------------------------
-- 3) 用户名校验唯一 —— 【关键】
--    云函数就是靠这个唯一索引拦截「重复注册」的，
--    没有它，重名检测不会生效。
--    执行前先跑下面这句确认没有重复数据：
-- ------------------------------------------------------------
-- SELECT user_id, COUNT(*) AS c FROM user_table GROUP BY user_id HAVING COUNT(*) > 1;

ALTER TABLE user_table
  ADD CONSTRAINT uq_user_table_user_id UNIQUE (user_id);

-- ------------------------------------------------------------
-- 4) 支部只能取 first / second
-- ------------------------------------------------------------
ALTER TABLE user_table
  ADD CONSTRAINT chk_user_table_branch CHECK (branch IN ('first', 'second'));

-- ------------------------------------------------------------
-- 5) 角色与岗位信息的一致性
--    管理员不能有岗位信息；员工必须有
-- ------------------------------------------------------------
ALTER TABLE user_table
  ADD CONSTRAINT chk_user_table_role CHECK (
    (admin = TRUE  AND type IS NULL     AND job IS NULL) OR
    (admin = FALSE AND type IS NOT NULL AND job IS NOT NULL)
  );

-- ============================================================
-- 建一个初始管理员（可选，用于首次登录）
-- 密码是明文，登录后建议立刻重建一个自己的账号
-- ============================================================
-- INSERT INTO user_table (user_id, pw, admin, name, branch)
-- VALUES ('admin', 'admin123', TRUE, '默认管理员', 'first');

-- ============================================================
-- 校验：看看最终结构
-- ============================================================
-- SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'user_table'
-- ORDER BY ordinal_position;
