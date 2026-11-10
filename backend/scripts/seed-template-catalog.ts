/**
 * 写真模板目录种子（2026-11-10）。
 *
 * 把 `capabilities/definitions/template.templates.ts` 里的 30 套模板导入数据库，
 * 形成「一级分类（文章/主题）→ 二级分类（风格/场景）→ 模板（图 + 提示词 + 标签）」。
 *
 * **幂等且不覆盖后台修改**：分类/分组按 slug 查，模板按固定 id 查；
 * 已存在就跳过。后台改名、调序、停用后再次执行 seed 不会把它们冲掉。
 *
 * 运行: npm run seed:templates（需先执行 prisma db push 建表）
 */
import { PrismaClient } from '@prisma/client';
import { NodeSQLiteDriverAdapterFactory } from '../dist/prisma/node-sqlite-adapter';
import {
  PORTRAIT_TEMPLATES,
  type PortraitTemplate,
} from '../src/capabilities/definitions/template.templates';
const { resolveDbUrl } = require('./db-url');

const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

const TAG_KEYWORDS = [
  '龙凤褂',
  '秀禾',
  '团扇',
  '灯笼',
  '中式',
  '红色',
  '金色',
  '复古',
  '室内',
  '户外',
  '花海',
  '草坪',
  '花艺',
  '花园',
  '棕榈',
  '日落',
  '蔷薇',
  '绿植',
  '校园',
  '操场',
  '看台',
  '校服',
  '日系',
  '青春',
  '泡泡',
  '气球',
  '婚纱',
  '头纱',
];

interface GroupSeed {
  slug: string;
  name: string;
  sortOrder: number;
  templateIds: string[];
}

interface CategorySeed {
  slug: string;
  name: string;
  sourceUrl: string;
  description: string;
  sortOrder: number;
  groups: GroupSeed[];
}

const CATEGORY_SEEDS: CategorySeed[] = [
  {
    slug: 'longfeng',
    name: '龙凤褂',
    sourceUrl: 'https://mp.weixin.qq.com/s/dHYyjCFYg9AipYTe1c0AEw',
    description: '龙凤褂 / 秀禾中式婚纱写真',
    sortOrder: 10,
    groups: [
      { slug: 'studio', name: '纯色棚拍', sortOrder: 10, templateIds: ['longfeng-01', 'longfeng-08', 'longfeng-09', 'longfeng-10'] },
      { slug: 'interior', name: '室内布景', sortOrder: 20, templateIds: ['longfeng-02', 'longfeng-03', 'longfeng-04', 'longfeng-05', 'longfeng-07'] },
      { slug: 'outdoor', name: '户外庭院', sortOrder: 30, templateIds: ['longfeng-06'] },
    ],
  },
  {
    slug: 'flower',
    name: '花海婚纱',
    sourceUrl: 'https://mp.weixin.qq.com/s/GCKyw-1JtZaZQOjmGenYNw',
    description: '草坪、花房与花墙主题的浪漫婚纱写真',
    sortOrder: 20,
    groups: [
      { slug: 'lawn', name: '草坪花海', sortOrder: 10, templateIds: ['flower-01', 'flower-03', 'flower-04', 'flower-05', 'flower-10'] },
      { slug: 'room', name: '室内花房', sortOrder: 20, templateIds: ['flower-02', 'flower-06', 'flower-09'] },
      { slug: 'wall', name: '花墙花境', sortOrder: 30, templateIds: ['flower-07', 'flower-08'] },
    ],
  },
  {
    slug: 'campus',
    name: '校园操场',
    sourceUrl: 'https://mp.weixin.qq.com/s/MP_FQuppTPvVCkPznfyt8g',
    description: '日系清新校园操场情侣写真',
    sortOrder: 30,
    groups: [
      { slug: 'lawn', name: '草坪操场', sortOrder: 10, templateIds: ['campus-01', 'campus-02', 'campus-03', 'campus-04', 'campus-08', 'campus-09', 'campus-10'] },
      { slug: 'stands', name: '看台', sortOrder: 20, templateIds: ['campus-05', 'campus-06', 'campus-07'] },
    ],
  },
];

const TEMPLATE_BY_ID = new Map(PORTRAIT_TEMPLATES.map((template) => [template.id, template]));

/** 标签 = 一级分类 + 二级分类 + 模板名 + 提示词命中的风格关键词（最多 6 个）。 */
function tagsFor(category: CategorySeed, group: GroupSeed, template: PortraitTemplate): string[] {
  const tags = new Set<string>([category.name, group.name, template.name]);
  for (const keyword of TAG_KEYWORDS) {
    if (template.prompt.includes(keyword)) tags.add(keyword);
    if (tags.size >= 6) break;
  }
  return [...tags];
}

async function main() {
  /*
   * 目录非空即整体跳过。
   *
   * 不能只按单条「已存在就跳过」：后台删掉一套模板后，下一次启动 seed
   * 会把它重新建回来 —— 运营会以为删除失效。这里把「是否已初始化」作为
   * 一个整体判断：首次建库灌入 30 套，之后完全交给后台维护。
   */
  const existingCategories = await prisma.templateCategory.count();
  if (existingCategories > 0) {
    console.log(
      `写真模板目录已存在（${existingCategories} 个一级分类），跳过种子；后续请通过后台「写真模板」维护`,
    );
    return;
  }

  let createdCategories = 0;
  let createdGroups = 0;
  let createdItems = 0;

  for (const categorySeed of CATEGORY_SEEDS) {
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

      for (const [index, templateId] of groupSeed.templateIds.entries()) {
        const template = TEMPLATE_BY_ID.get(templateId);
        if (!template) {
          console.warn(`  跳过未知模板 id: ${templateId}`);
          continue;
        }
        const exists = await prisma.templateItem.findUnique({ where: { id: template.id } });
        if (exists) continue;
        await prisma.templateItem.create({
          data: {
            id: template.id,
            groupId: group.id,
            name: template.name,
            prompt: template.prompt,
            imageUrl: template.thumbFile,
            tags: JSON.stringify(tagsFor(categorySeed, groupSeed, template)),
            sortOrder: (index + 1) * 10,
            enabled: true,
          },
        });
        createdItems += 1;
      }
    }
  }

  console.log(
    `写真模板种子完成：新增分类 ${createdCategories}、分组 ${createdGroups}、模板 ${createdItems}（已存在的跳过）`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
