/**
 * 写真模板扩充目录导入（2026-11-11）。
 *
 * 把 `src/capabilities/definitions/portrait-templates.import.ts` 中
 * 60 篇微信公众号文章去重后的 520 套模板，按
 * 「一级分类 → 二级分类（来源文章）→ 模板」写入数据库目录表。
 *
 * **幂等且不覆盖后台修改**：一级分类按 slug、二级分类按 (categoryId, slug)、
 * 模板按固定 id 查询，已存在即跳过；后台改名、调序、停用、删除后再次执行
 * 不会被冲掉（删除的模板同样不会被重新建回来，这点与 seed:templates 不同——
 * 本脚本是显式的一次性补录，重跑只补齐缺失项）。
 *
 * 运行: npm run import:templates
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
import { PORTRAIT_TEMPLATE_IMPORT } from '../src/capabilities/definitions/portrait-templates.import';
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

const PUBLIC_ROOT = path.resolve(__dirname, '../../frontend/public');

async function main() {
  let createdCategories = 0;
  let createdGroups = 0;
  let createdItems = 0;
  let skippedItems = 0;
  const missingImages: string[] = [];

  for (const categorySeed of PORTRAIT_TEMPLATE_IMPORT.categories) {
    let category = await prisma.templateCategory.findUnique({
      where: { slug: categorySeed.slug },
    });
    if (!category) {
      category = await prisma.templateCategory.create({
        data: {
          slug: categorySeed.slug,
          name: categorySeed.name,
          sourceUrl: categorySeed.sourceUrl,
          description: categorySeed.description,
          sortOrder: categorySeed.sortOrder,
          enabled: true,
        },
      });
      createdCategories += 1;
    }

    for (const groupSeed of categorySeed.groups) {
      let group = await prisma.templateGroup.findUnique({
        where: {
          categoryId_slug: { categoryId: category.id, slug: groupSeed.slug },
        },
      });
      if (!group) {
        group = await prisma.templateGroup.create({
          data: {
            categoryId: category.id,
            slug: groupSeed.slug,
            name: groupSeed.name,
            sortOrder: groupSeed.sortOrder,
            enabled: true,
          },
        });
        createdGroups += 1;
      }

      for (const itemSeed of groupSeed.items) {
        const exists = await prisma.templateItem.findUnique({ where: { id: itemSeed.id } });
        if (exists) {
          skippedItems += 1;
          continue;
        }
        if (!fs.existsSync(path.join(PUBLIC_ROOT, itemSeed.imageUrl.replace(/^\//, '')))) {
          missingImages.push(itemSeed.imageUrl);
        }
        await prisma.templateItem.create({
          data: {
            id: itemSeed.id,
            groupId: group.id,
            name: itemSeed.name,
            prompt: itemSeed.prompt,
            imageUrl: itemSeed.imageUrl,
            tags: JSON.stringify(itemSeed.tags),
            sortOrder: itemSeed.sortOrder,
            enabled: true,
          },
        });
        createdItems += 1;
      }
    }
    console.log(
      `  ${categorySeed.name.padEnd(6, '　')} 分组 ${categorySeed.groups.length} / 模板 ${categorySeed.groups.reduce((n, g) => n + g.items.length, 0)}`,
    );
  }

  console.log(
    `写真模板扩充导入完成：新增分类 ${createdCategories}、分组 ${createdGroups}、模板 ${createdItems}；已存在跳过 ${skippedItems}`,
  );
  if (missingImages.length > 0) {
    console.warn(`  ⚠️  ${missingImages.length} 张预览图未找到本地文件，例如：${missingImages.slice(0, 3).join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
