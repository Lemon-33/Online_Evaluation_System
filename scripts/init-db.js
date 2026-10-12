/**
 * CloudBase 数据库集合与安全规则初始化脚本
 *
 * 用法：
 *   1. 安装 CloudBase CLI：      npm i -g @cloudbase/cli
 *   2. 登录：                    tcb login
 *   3. 修改本文件顶部 envId 为你的环境 ID
 *   4. 执行：                    node scripts/init-db.js
 *
 * 安全规则说明：
 *   - 演示模式（默认）：所有人可读写，仅用于内部试用
 *   - 生产环境请按角色收紧：仅党员本人能写自己的记录，仅管理员可读取全部
 */

const cloudbase = require('@cloudbase/js-sdk');

const ENV_ID = process.env.TCB_ENV || 'your-env-id';

const COLLECTION = 'evaluations';

// 安全规则：所有人可读写（演示用，生产请改为按角色限制）
const SECURITY_RULE = {
  read: true,
  write: true,
};

async function main() {
  const tcb = cloudbase.init({ env: ENV_ID });
  // 这里走管理员 token；执行前请先 tcb login
  try {
    await tcb.auth().signInAnonymously();
  } catch (e) {
    console.log('匿名登录失败，请先执行 tcb login 后再尝试');
  }

  const db = tcb.database();

  // 创建集合（若已存在会报错，可忽略）
  try {
    await db.createCollection(COLLECTION);
    console.log(`✓ 已创建集合 ${COLLECTION}`);
  } catch (e) {
    console.log(`• 集合 ${COLLECTION} 可能已存在：`, e.message || e);
  }

  // 设置安全规则
  try {
    await db.collection(COLLECTION).setPermissions(SECURITY_RULE);
    console.log(`✓ 已设置 ${COLLECTION} 权限：`, SECURITY_RULE);
  } catch (e) {
    console.log('• 设置权限失败，请到控制台手动配置：', e.message || e);
  }

  console.log('\n后续步骤：');
  console.log(' 1. 在 CloudBase 控制台 -> 数据库 -> evaluations，创建索引：');
  console.log('    - 索引名: idx_name_year, key: { name: 1, year: 1 }, unique: true');
  console.log(' 2. 在 CloudBase 控制台 -> 静态网站托管，开启托管并上传 dist 目录');
  console.log(' 3. 把本项目根目录 .env.example 复制为 .env，填入 VITE_TCB_ENV 后重新构建');
}

main();