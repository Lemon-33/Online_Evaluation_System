#!/usr/bin/env node
// ============================================================
// 口令哈希生成器（给 server/.env 的 BACKDOOR_PASSWORD_HASH 用）
// ------------------------------------------------------------
// 用法（在 server/ 目录下执行）：
//   ① 随机生成一个新口令（推荐）：
//        node hash-password.mjs
//      输出里有明文口令 + 对应的哈希行，把哈希行粘进 .env 即可。
//   ② 把某个**已有**口令转成哈希（口令本身不变，只是不再明文存）：
//        node hash-password.mjs "现有口令"
//
// 说明：
//   - 哈希算法与 server.js 里的 hashPassword 完全一致（scrypt / N=16384 / r=8 / p=1 /
//     16 字节随机盐 / 32 字节摘要），格式：scrypt$16384$8$1$<salt>$<hash>
//   - 哈希是单向的：生成后**再也无法反推明文**，请务必把明文自己保存好
//     （密码管理器 / 纸质保险柜），忘了只能重新生成一个。
//   - 本脚本只打印，不写文件；也没有任何参数会让它去改 .env。
// ============================================================
import crypto from 'crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

function hashPassword(plain) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const key = crypto.scryptSync(String(plain ?? ''), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

const input = process.argv.slice(2).join(' ').trim();
const generated = !input;
// 26 个字符 × 6 bit ≈ 156 bit 熵，且不含 $ 和引号，粘贴进 .env 不会被解析规则吃掉
const plain = generated
  ? crypto.randomBytes(20).toString('base64url').slice(0, 26)
  : input;

if (plain.length < 12) {
  console.warn('⚠️  该口令不足 12 位，建议换更长的（后门账号权限很高）。\n');
}

const hash = hashPassword(plain);

console.log('------------------------------------------------------------');
if (generated) {
  console.log('已随机生成新口令（请立刻记到密码管理器里）：');
  console.log('');
  console.log('    明文口令：' + plain);
} else {
  console.log('已把下面这个口令转成哈希（口令本身不变）：');
  console.log('');
  console.log('    明文口令：' + plain);
}
console.log('');
console.log('把下面这一行写进 server/.env（替换掉原有的 BACKDOOR_PASSWORD / BACKDOOR_PASSWORD_HASH）：');
console.log('');
console.log('BACKDOOR_PASSWORD_HASH=' + hash);
console.log('');
console.log('然后重启后端。库里的系统管理员口令会在启动时自动对齐到这份哈希。');
console.log('------------------------------------------------------------');
