process.env.NODE_ENV = process.env.NODE_ENV || 'development';
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../src/prisma/node-sqlite-adapter';
const { resolveDbUrl } = require('./db-url');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });
async function main() {
  for (const name of ['扣费验证渠道-1793433544477', 'probe-1793433752947']) {
    const ch = await prisma.modelChannel.findFirst({ where: { name } });
    if (!ch) { console.log(name, '=> 不存在'); continue; }
    const models = await prisma.channelModel.findMany({ where: { channelId: ch.id } });
    console.log(name, 'id=', ch.id, 'modelsJson=', ch.modelsJson, 'createdAt=', ch.createdAt);
    console.log('  models:', models.map(m => ({ key: m.modelKey, enabled: m.enabled, deletedAt: m.deletedAt })));
  }
}
main().finally(() => prisma.$disconnect());
