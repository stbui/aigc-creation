import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { SettingImageService } from '../common/setting-image.service';
import { StorageService } from '../storage/storage.service';
import {
  inspectUploadedImage,
  maxUploadBytes,
  verifyDecodableImage,
} from '../assets/image-validation';
import type {
  CreateTemplateCategoryDto,
  CreateTemplateGroupDto,
  CreateTemplateItemDto,
  UpdateTemplateCategoryDto,
  UpdateTemplateGroupDto,
  UpdateTemplateItemDto,
} from './dto';

/** JSON 标签数组 → 字符串数组；坏数据按空数组处理，不阻断整页。 */
export function parseTemplateTags(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
      : [];
  } catch {
    return [];
  }
}

/** 标签归一：去空白、去重、单条 ≤20 字、最多 8 条。 */
export function normalizeTemplateTags(tags: string[] | undefined): string {
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const tag = String(raw ?? '').trim().slice(0, 20);
    if (tag) seen.add(tag);
    if (seen.size >= 8) break;
  }
  return JSON.stringify([...seen]);
}

/**
 * 写真模板目录服务。
 *
 * C 端与后台共用同一份读取逻辑：后台看到的是全量（含停用），
 * C 端只看到 `enabled=true` 且至少有 1 条启用模板的分类/分组。
 * 图片引用统一经 `SettingImageService` 解析 —— 静态路径原样返回，
 * `storage://` 引用与 `/uploads/*` 则换成当前可访问的预览地址。
 */
@Injectable()
export class TemplateCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingImages: SettingImageService,
    private readonly storage: StorageService,
  ) {}

  /**
   * C 端目录：仅启用内容，按分类 → 分组 → 模板排序。
   * 空分组与空分类不下发，避免用户点开一个空 tab。
   */
  async publicCatalog() {
    const categories = await this.prisma.templateCategory.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        groups: {
          where: { enabled: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            items: {
              where: { enabled: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });

    const result = [];
    for (const category of categories) {
      const groups = [];
      for (const group of category.groups) {
        if (group.items.length === 0) continue;
        groups.push({
          id: group.id,
          slug: group.slug,
          name: group.name,
          items: await Promise.all(group.items.map((item) => this.publicItem(item))),
        });
      }
      /*
       * 空分类仍然下发：后台新建的「女生写真 / 男生写真 / 职业形象 …」
       * 需要立即出现在 C 端顶部 tab，等待运营补充二级分类与模板。
       * 页面在空分类下显示「该分类下暂无模板」，而不是让 tab 消失。
       */
      result.push({
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        sourceUrl: category.sourceUrl,
        groups,
      });
    }
    return { categories: result };
  }

  /** 后台目录：全量，含停用项；每项同时返回原始引用与预览地址。 */
  async adminCatalog() {
    const categories = await this.prisma.templateCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        groups: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          },
        },
      },
    });

    return {
      categories: await Promise.all(
        categories.map(async (category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
          sourceUrl: category.sourceUrl,
          description: category.description,
          sortOrder: category.sortOrder,
          enabled: category.enabled,
          createdAt: category.createdAt.toISOString(),
          updatedAt: category.updatedAt.toISOString(),
          groups: await Promise.all(
            category.groups.map(async (group) => ({
              id: group.id,
              categoryId: group.categoryId,
              slug: group.slug,
              name: group.name,
              sortOrder: group.sortOrder,
              enabled: group.enabled,
              itemCount: group.items.length,
              createdAt: group.createdAt.toISOString(),
              updatedAt: group.updatedAt.toISOString(),
              items: await Promise.all(group.items.map((item) => this.adminItem(item))),
            })),
          ),
        })),
      ),
    };
  }

  // ── 一级分类 ──

  async createCategory(dto: CreateTemplateCategoryDto) {
    const data = {
      slug: dto.slug,
      name: dto.name,
      sourceUrl: dto.sourceUrl ?? '',
      description: dto.description ?? '',
      sortOrder: dto.sortOrder ?? 0,
      enabled: dto.enabled ?? true,
    };
    return this.withUniqueSlug('分类', () =>
      this.prisma.templateCategory.create({ data }),
    );
  }

  async updateCategory(id: string, dto: UpdateTemplateCategoryDto) {
    await this.requireCategory(id);
    const data: Record<string, unknown> = {};
    for (const key of ['slug', 'name', 'sourceUrl', 'description', 'sortOrder', 'enabled'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    return this.withUniqueSlug('分类', () =>
      this.prisma.templateCategory.update({ where: { id }, data }),
    );
  }

  async removeCategory(id: string) {
    const category = await this.prisma.templateCategory.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { groups: true } },
      },
    });
    if (!category) throw new AppError(40400, '模板分类不存在', 404);
    const groupCount = category._count.groups;
    const itemCount = await this.prisma.templateItem.count({
      where: { group: { categoryId: id } },
    });
    await this.prisma.templateCategory.delete({ where: { id } });
    return { id, name: category.name, removedGroups: groupCount, removedItems: itemCount };
  }

  // ── 二级分类 ──

  async createGroup(dto: CreateTemplateGroupDto) {
    await this.requireCategory(dto.categoryId);
    return this.withUniqueGroupSlug(() =>
      this.prisma.templateGroup.create({
        data: {
          categoryId: dto.categoryId,
          slug: dto.slug,
          name: dto.name,
          sortOrder: dto.sortOrder ?? 0,
          enabled: dto.enabled ?? true,
        },
      }),
    );
  }

  async updateGroup(id: string, dto: UpdateTemplateGroupDto) {
    const existing = await this.requireGroup(id);
    const data: Record<string, unknown> = {};
    for (const key of ['slug', 'name', 'sortOrder', 'enabled'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    return this.withUniqueGroupSlug(() =>
      this.prisma.templateGroup.update({ where: { id }, data }),
    );
  }

  async removeGroup(id: string) {
    const group = await this.prisma.templateGroup.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    if (!group) throw new AppError(40400, '模板分组不存在', 404);
    await this.prisma.templateGroup.delete({ where: { id } });
    return { id, name: group.name, removedItems: group._count.items };
  }

  // ── 模板条目 ──

  async createItem(dto: CreateTemplateItemDto) {
    await this.requireGroup(dto.groupId);
    const imageUrl = this.assertImageUrl(dto.imageUrl);
    return this.prisma.templateItem.create({
      data: {
        groupId: dto.groupId,
        name: dto.name,
        prompt: dto.prompt,
        imageUrl,
        tags: normalizeTemplateTags(dto.tags),
        sortOrder: dto.sortOrder ?? 0,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateItem(id: string, dto: UpdateTemplateItemDto) {
    await this.requireItem(id);
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'prompt', 'sortOrder', 'enabled'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.imageUrl !== undefined) data.imageUrl = this.assertImageUrl(dto.imageUrl);
    if (dto.tags !== undefined) data.tags = normalizeTemplateTags(dto.tags);
    return this.prisma.templateItem.update({ where: { id }, data });
  }

  async removeItem(id: string) {
    const item = await this.prisma.templateItem.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!item) throw new AppError(40400, '模板不存在', 404);
    await this.prisma.templateItem.delete({ where: { id } });
    return item;
  }

  // ── 图片上传 ──

  /**
   * 后台上传模板预览图。
   *
   * 与系统设置图片共用存储链路：先落存储后端，返回稳定引用
   * `storage://<backend>/<key>`；模板记录只存引用，预览地址每次读取时生成。
   */
  async uploadImage(file?: { buffer?: Buffer; originalname?: string }) {
    const buffer = file?.buffer;
    if (!buffer?.length) throw new AppError(40001, '请选择要上传的图片', 400);

    const info = inspectUploadedImage(buffer, { maxBytes: maxUploadBytes() });
    /*
     * Jimp 1.6 没有内置 WebP 解码器；WebP 已经过文件头、尺寸与像素上限校验，
     * 存储与浏览器展示不依赖服务端解码，故跳过 Jimp 二次解码。
     * PNG / JPEG 仍保持完整解码校验。
     */
    if (info.mime !== 'image/webp') {
      await verifyDecodableImage(buffer, info);
    }

    const provider = this.storage.getActive();
    const key = this.storage.buildKey('templates', info.ext);
    let stored = false;
    try {
      const object = await provider.put(key, buffer, info.mime);
      stored = true;
      const imageUrl = this.settingImages.toReference(provider.backend, key);
      const previewUrl = await this.settingImages.displayUrl(imageUrl);
      if (!previewUrl) throw new AppError(50001, '图片已上传但预览地址生成失败', 500);
      return {
        imageUrl,
        previewUrl,
        width: info.width,
        height: info.height,
        sizeBytes: object.sizeBytes,
      };
    } catch (error) {
      if (stored) await provider.delete(key).catch(() => undefined);
      throw error;
    }
  }

  // ── 内部 ──

  /**
   * C 端目录条目：**不下发 prompt**。
   *
   * `/template/templates` 是免登录公开接口，提示词是模板的商业资产，
   * 前端只传 `templateId`，生成侧由 `Template.buildPrompt` 按 id 查回风格描述。
   * 后台编辑仍通过 `adminItem()` 拿到完整 prompt。
   */
  private async publicItem(item: {
    id: string;
    name: string;
    imageUrl: string;
    tags: string;
  }) {
    return {
      id: item.id,
      name: item.name,
      thumbFile: (await this.settingImages.displayUrl(item.imageUrl)) ?? item.imageUrl,
      tags: parseTemplateTags(item.tags),
    };
  }

  private async adminItem(item: {
    id: string;
    groupId: string;
    name: string;
    prompt: string;
    imageUrl: string;
    tags: string;
    sortOrder: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      groupId: item.groupId,
      name: item.name,
      prompt: item.prompt,
      imageUrl: item.imageUrl,
      thumbFile: (await this.settingImages.displayUrl(item.imageUrl)) ?? '',
      tags: parseTemplateTags(item.tags),
      sortOrder: item.sortOrder,
      enabled: item.enabled,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private async requireCategory(id: string) {
    const category = await this.prisma.templateCategory.findUnique({ where: { id } });
    if (!category) throw new AppError(40400, '模板分类不存在', 404);
    return category;
  }

  private async requireGroup(id: string) {
    const group = await this.prisma.templateGroup.findUnique({ where: { id } });
    if (!group) throw new AppError(40400, '模板分组不存在', 404);
    return group;
  }

  private async requireItem(id: string) {
    const item = await this.prisma.templateItem.findUnique({ where: { id } });
    if (!item) throw new AppError(40400, '模板不存在', 404);
    return item;
  }

  /** 图片只允许站内静态路径、存储引用或绝对 http(s) 地址。 */
  private assertImageUrl(raw: string): string {
    const value = String(raw ?? '').trim();
    if (!value) throw new AppError(40001, '请上传或填写模板图片', 400);
    const allowed =
      value.startsWith('/templates/') ||
      value.startsWith('/uploads/') ||
      value.startsWith('storage://') ||
      value.startsWith('http://') ||
      value.startsWith('https://');
    if (!allowed) throw new AppError(40001, '模板图片地址格式无效', 400);
    return value;
  }

  private async withUniqueSlug<T>(label: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppError(40901, `${label} slug 已存在`, 409);
      }
      throw error;
    }
  }

  private async withUniqueGroupSlug<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppError(40901, '该分类下已存在同名 slug 的分组', 409);
      }
      throw error;
    }
  }
}
