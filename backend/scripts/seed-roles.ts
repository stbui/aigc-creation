/**
 * 幂等 seed: provision 后台三角色与内置权限点。
 *
 * 为什么需要: AdminGuard 实时读 AdminRole.permissions, 表为空时所有后台
 * 请求都会被兜底默认拒拦下, 管理员无法进入后台配置权限 —— 形成死锁。
 *
 * 与 seed-demo-user.ts 的区别 (重要):
 *   演示账号 admin@demo.com 的凭据硬编码在前端产物 lib/constants.ts,
 *   **不得**给它 admin 角色 —— 等于把后台入口挂在公开可见的位置。
 *   管理员由本脚本 seed-admin.ts 生成, 密码随机且只在本次输出一次。
 *
 * 运行: npm run seed          (角色与权限点)
 *      npm run seed:admin     (管理员账号, 可重复运行)
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
// 库路径与后端服务同源 (按 NODE_ENV 读 DATABASE_URL), 否则 seed 会写错库
const { resolveDbUrl } = require('./db-url');
import {
  ADMIN_ROLE_CODES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
} from '../src/admin/permissions';

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

async function seedRoles(): Promise<void> {
  for (const code of ADMIN_ROLE_CODES) {
    const permissions = ROLE_PERMISSIONS[code];
    const name = ROLE_LABELS[code];
    const existing = await prisma.adminRole.findUnique({ where: { code } });

    if (existing) {
      // 权限以代码里的定义为准回写, 保证 PERMISSIONS 增删后库内同步。
      // 注意: 这会覆盖运营在角色页做过的调整 —— seed 是初始化手段,
      // 生产环境的调整应通过角色页写入, 不要依赖 seed 反复跑。
      await prisma.adminRole.update({
        where: { code },
        data: { permissions: JSON.stringify(permissions) },
      });
      console.log(`[seed] 角色已存在, 权限已同步: ${code} (${permissions.length} 项)`);
    } else {
      await prisma.adminRole.create({
        data: { code, name, permissions: JSON.stringify(permissions), builtIn: true },
      });
      console.log(`[seed] 已创建角色: ${code} (${permissions.length} 项权限)`);
    }
  }
}

async function main(): Promise<void> {
  try {
    await seedRoles();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] 失败:', err);
  process.exit(1);
});