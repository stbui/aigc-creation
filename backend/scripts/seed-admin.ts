/**
 * 创建后台管理员账号 (幂等)。
 *
 * 为什么必须独立于 seed-dev-user.ts:
 *   后者 provision 的是 C 端普通账号（注册页同样能建），凭据由部署者用环境变量
 *   决定，任何拿到该邮箱的人都能登录。若把它顺手提成 admin，等于把后台入口
 *   挂在一个人人都能注册的位置。后台身份只从这里创建。
 *   （2026-10-22 起前端不再硬编码演示凭据，这条边界仍然成立：C 端账号 ≠ 后台账号。）
 *
 * 密码策略: 20 位随机, 含大小写字母与数字, 不含易混淆字符 (0O1lI)。
 * 明文仅在本次运行输出一次, 不写库、不落盘、不入前端。
 *
 * 运行: npm run seed:admin
 *      ADMIN_EMAIL=ops@company.com npm run seed:admin    指定邮箱
 * 重复执行不会重置密码 (避免把运营正在用的账号锁掉), 如需改密码走后台用户管理。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');
import { USER_STATUSES } from '../src/admin/permissions';

const DEFAULT_EMAIL = process.env.ADMIN_EMAIL || 'admin@huojue.local';
const PASSWORD_LENGTH = 20;

/** 去掉易混淆字符 (0/O, 1/l/I) —— 管理员密码常被手工输入, 去掉歧义 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  // 保证三类字符齐全
  const hasUpper = /[A-Z]/.test(out);
  const hasLower = /[a-z]/.test(out);
  const hasDigit = /[0-9]/.test(out);
  if (hasUpper && hasLower && hasDigit) return out;
  return generatePassword(); // 概率极低, 重试即可
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
  });

  try {
    const existing = await prisma.user.findUnique({ where: { email: DEFAULT_EMAIL } });

    if (existing) {
      if (existing.role === 'admin') {
        console.log(`[seed:admin] 管理员已存在, 跳过: ${DEFAULT_EMAIL}`);
        console.log('  如需重置密码, 请使用后台「用户管理 → 重置密码」, 或手动删除该账号后重跑。');
      } else {
        // 账号存在但不是管理员: 提升而不是新建, 避免同邮箱两账号冲突
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'admin', status: 'active' },
        });
        console.log(`[seed:admin] 已将现有账号提升为管理员: ${DEFAULT_EMAIL}`);
      }
      return;
    }

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email: DEFAULT_EMAIL,
        passwordHash,
        name: '平台管理员',
        role: 'admin',
        // 显式写入白名单内的status: 依赖 schema 默认值会让"默认值即契约"变模糊
        status: USER_STATUSES[0],
      },
    });

    console.log('');
    console.log('='.repeat(60));
    console.log('  后台管理员已创建');
    console.log('='.repeat(60));
    console.log(`  邮箱: ${DEFAULT_EMAIL}`);
    console.log(`  密码: ${password}`);
    console.log('');
    console.log('  ⚠ 此密码仅显示这一次, 关闭后无法再次查看。');
    console.log('  ⚠ 请立即保存, 并在首次登录后修改。');
    console.log('');
    console.log('  登录入口: /admin (前端需已启动)');
    console.log('='.repeat(60));
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed:admin] 失败:', err);
  process.exit(1);
});