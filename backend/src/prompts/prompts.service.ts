import { readFile } from 'fs/promises';

import { Injectable } from '@nestjs/common';

import { buildPage, paginate, type PageQueryInput } from '../admin/dto/page-query.dto';
import { inspectUploadedImage, verifyDecodableImage } from '../assets/image-validation';
import { AppError } from '../common/app.exception';
import { parseSettingImageReference, SettingImageService } from '../common/setting-image.service';
import { SettingsService } from '../common/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { StorageBackend } from '../storage/storage.provider';
import { PROMPT_IMAGES_MAX, type PromptModality } from './dto';

/** 提示词列表查询入参（HTTP 层传 PromptListQueryInput，结构兼容） */
export interface PromptListQueryInput extends PageQueryInput {
  keyword?: string;
  category?: string;
  modality?: PromptModality;
  enabled?: boolean;
}

/** 配图引用的领域形状；HTTP 层的 PromptImageDto 实例结构兼容 */
export interface PromptImageInput {
  ref: string;
  assetId?: string;
  name?: string;
}

export interface CreatePromptInput {
  title?: string;
  category?: string;
  content: string;
  negativePrompt?: string;
  modality?: PromptModality;
  tags?: string[];
  images?: PromptImageInput[];
  sortOrder?: number;
  enabled?: boolean;
}

export interface UpdatePromptInput {
  title?: string;
  category?: string;
  content?: string;
  negativePrompt?: string;
  modality?: PromptModality;
  tags?: string[];
  images?: PromptImageInput[];
  sortOrder?: number;
  enabled?: boolean;
}

/** JSON 标签数组 → 字符串数组；坏数据按空数组处理，不阻断整页。 */
export function parsePromptTags(raw: string | null | undefined): string[] {
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
export function normalizePromptTags(tags: string[] | undefined): string {
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const tag = String(raw ?? '')
      .trim()
      .slice(0, 20);
    if (tag) seen.add(tag);
    if (seen.size >= 8) break;
  }
  return JSON.stringify([...seen]);
}

/**
 * 配图 JSON → 结构化数组；坏数据按空数组处理，不阻断整页。
 *
 * 只保留带非空 `ref` 的项：手工改库留下的空壳会让前端渲染一个永远加载不出来的占位。
 */
export function parsePromptImages(raw: string | null | undefined): PromptImageInput[] {
  try {
    const value = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        ref: String(item.ref ?? '').trim(),
        ...(typeof item.assetId === 'string' && item.assetId ? { assetId: item.assetId } : {}),
        ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}),
      }))
      .filter((item) => item.ref !== '')
      .slice(0, PROMPT_IMAGES_MAX);
  } catch {
    return [];
  }
}

/**
 * 配图归一：去空白、去重（按 ref）、限制张数。
 *
 * 去重按 `ref` 而非 `assetId` —— 同一张素材可能先被上传、后从素材库选入，
 * 此时只有 ref 相同。重复配图在 C 端只会重复占位，没有业务价值。
 */
export function normalizePromptImages(images: PromptImageInput[] | undefined): string {
  const seen = new Set<string>();
  const result: PromptImageInput[] = [];
  for (const raw of images ?? []) {
    const ref = String(raw?.ref ?? '').trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const assetId = String(raw?.assetId ?? '').trim();
    const name = String(raw?.name ?? '').trim();
    result.push({
      ref,
      ...(assetId ? { assetId } : {}),
      ...(name ? { name } : {}),
    });
    if (result.length >= PROMPT_IMAGES_MAX) break;
  }
  return JSON.stringify(result);
}

/** 列表可排序字段白名单 —— 用户可控的字段名不能直接透传给 Prisma。 */
const SORTABLE_FIELDS = ['sortOrder', 'createdAt', 'updatedAt', 'title'];

/**
 * 本接口上传的配图对象 key 前缀。
 *
 * 回收只碰这个前缀：同一存储后端还存着素材库的 `original/*`、模板预览图等，
 * 它们可能被别处引用，按「提示词里没有这个 ref」就去删会误伤。
 */
const PROMPT_IMAGE_KEY_PREFIX = 'prompts/';

/**
 * 提示词库服务。
 *
 * 当前只服务后台管理（C 端页面未设计）。条目与模板条目里的 `prompt` 字段
 * 是两回事：这里是可独立复用的提示词资产，不绑定图片或分组。
 *
 * 配图存**稳定引用**而非签名地址：签名 URL 有有效期，入库后过几小时全部 403。
 * 读取时经 `SettingImageService` 重新解析成当前可访问的预览地址。
 */
@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingImages: SettingImageService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: PromptListQueryInput) {
    const page = buildPage(query, SORTABLE_FIELDS, 'sortOrder:asc');
    const where = this.buildWhere(query);

    const [rows, total, categories] = await Promise.all([
      this.prisma.prompt.findMany({
        where,
        orderBy: page.orderBy,
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.prompt.count({ where }),
      // 筛选项不受当前筛选影响：否则选中「人像」后，其它分类会从下拉里消失。
      this.prisma.prompt.findMany({
        where: { category: { not: '' } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
    ]);

    return {
      ...paginate(await Promise.all(rows.map((row) => this.toView(row))), total, page),
      categories: categories.map((item) => item.category),
    };
  }

  async get(id: string) {
    const prompt = await this.requirePrompt(id);
    return this.toView(prompt);
  }

  async create(dto: CreatePromptInput) {
    const content = String(dto.content ?? '').trim();
    if (!content) throw new AppError(40001, '请填写提示词内容', 400);

    const row = await this.prisma.prompt.create({
      data: {
        title: String(dto.title ?? '').trim(),
        category: String(dto.category ?? '').trim(),
        content,
        negativePrompt: String(dto.negativePrompt ?? '').trim(),
        modality: dto.modality ?? 'image',
        tags: normalizePromptTags(dto.tags),
        images: normalizePromptImages(dto.images),
        sortOrder: dto.sortOrder ?? 0,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpdatePromptInput) {
    const before = await this.requirePrompt(id);

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.content !== undefined) {
      const content = dto.content.trim();
      if (!content) throw new AppError(40001, '请填写提示词内容', 400);
      data.content = content;
    }
    if (dto.category !== undefined) data.category = dto.category.trim();
    if (dto.negativePrompt !== undefined) data.negativePrompt = dto.negativePrompt.trim();
    if (dto.modality !== undefined) data.modality = dto.modality;
    if (dto.tags !== undefined) data.tags = normalizePromptTags(dto.tags);
    if (dto.images !== undefined) data.images = normalizePromptImages(dto.images);
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const row = await this.prisma.prompt.update({ where: { id }, data });

    if (dto.images !== undefined) {
      // 保存成功后再回收：先删对象后写库，更新失败就会留下打不开的配图。
      const next = new Set(parsePromptImages(row.images).map((image) => image.ref));
      const dropped = parsePromptImages(before.images)
        .map((image) => image.ref)
        .filter((ref) => !next.has(ref));
      await this.discardOrphanImages(dropped);
    }

    return this.toView(row);
  }

  async remove(id: string) {
    const prompt = await this.requirePrompt(id);
    await this.prisma.prompt.delete({ where: { id } });
    // 删除成功后再回收对象；回收失败不影响删除结果，只留下无主文件。
    await this.discardOrphanImages(parsePromptImages(prompt.images).map((image) => image.ref));
    return { id: prompt.id, title: prompt.title };
  }

  /**
   * 批量上传配图。
   *
   * 与模板预览图共用存储链路：先落存储后端，返回稳定引用
   * `storage://<backend>/<key>` 与当前预览地址；提示词记录只存引用。
   *
   * 文件由 multer 落到临时目录，这里逐张读回校验；任何一张不合格时**整批
   * 不落库**，已写入的对象在 catch 里逐个删除，避免留下无主文件。
   */
  async uploadImages(
    files: Array<{ path?: string; buffer?: Buffer; originalname?: string }> | undefined,
  ) {
    // multer 现在落磁盘（`diskStorage`），内存 buffer 只在直接调用/测试时出现。
    const picked = (files ?? []).filter((file) => file?.path || file?.buffer?.length);
    if (picked.length === 0) throw new AppError(40001, '请选择要上传的图片', 400);
    if (picked.length > PROMPT_IMAGES_MAX) {
      throw new AppError(40001, `单次最多上传 ${PROMPT_IMAGES_MAX} 张图片`, 400);
    }

    const limits = await this.settings.uploadLimits();

    /*
     * 逐张「读盘 → 校验 → 写存储」，不先把 9 个 buffer 一起读进内存。
     * multer 已把文件落盘，这里再全部读回等于把刚才省下的内存又占回去；
     * 失败时由 catch 删除此前写入的对象，整批不落库的语义不变。
     */
    const provider = this.storage.getActive();
    const stored: string[] = [];
    try {
      const results = [];
      for (const file of picked) {
        const buffer = file.buffer ?? (await readFile(file.path as string));
        const info = inspectUploadedImage(buffer, limits);
        /*
         * Jimp 1.6 没有内置 WebP 解码器；WebP 已经过文件头、尺寸与像素上限校验，
         * 存储与浏览器展示不依赖服务端解码，故跳过 Jimp 二次解码。
         */
        if (info.mime !== 'image/webp') await verifyDecodableImage(buffer, info);

        const key = this.storage.buildKey('prompts', info.ext);
        const object = await provider.put(key, buffer, info.mime);
        stored.push(key);
        const ref = this.settingImages.toReference(provider.backend, key);
        const previewUrl = await this.settingImages.displayUrl(ref);
        if (!previewUrl) throw new AppError(50001, '图片已上传但预览地址生成失败', 500);
        results.push({
          ref,
          previewUrl,
          width: info.width,
          height: info.height,
          sizeBytes: object.sizeBytes,
          name: String(file.originalname ?? '').trim().slice(0, 80),
        });
      }
      return { items: results };
    } catch (error) {
      await Promise.all(stored.map((key) => provider.delete(key).catch(() => undefined)));
      throw error;
    }
  }

  /**
   * 回收不再被任何提示词引用的本接口上传对象。
   *
   * 只处理 `storage://<backend>/prompts/...`：
   *   · 素材库 / 模板的 key 不走 `prompts/` 前缀，不能连带删；
   *   · 其它提示词可能仍引用同一对象（复制条目、手工填 ref），先查一遍再用；
   *   · 全程 best-effort —— 对象已不存在、后端不可用都不该让写操作失败。
   */
  private async discardOrphanImages(refs: string[]) {
    if (refs.length === 0) return;

    try {
      const pending = new Map<StorageBackend, Set<string>>();
      for (const ref of new Set(refs)) {
        const parsed = parseSettingImageReference(ref);
        if (!parsed || !parsed.key.startsWith(PROMPT_IMAGE_KEY_PREFIX)) continue;
        // `contains` 是子串匹配，宁可多留一个孤儿对象，也不删掉别处在用的图。
        const stillUsed = await this.prisma.prompt.count({ where: { images: { contains: ref } } });
        if (stillUsed > 0) continue;
        const keys = pending.get(parsed.backend) ?? new Set<string>();
        keys.add(parsed.key);
        pending.set(parsed.backend, keys);
      }

      await Promise.all(
        [...pending].map(async ([backend, keys]) => {
          const provider = this.storage.get(backend);
          if (!provider) return;
          await Promise.all([...keys].map((key) => provider.delete(key).catch(() => undefined)));
        }),
      );
    } catch {
      /*
       * 回收是写操作成功之后的 best-effort 收尾：查询或删除失败只留下无主对象，
       * 不能把一次已经落库的保存 / 删除变回报错 —— 运营会以为没生效而重试。
       */
    }
  }

  private buildWhere(query: PromptListQueryInput): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (query.category) where.category = query.category;
    if (query.modality) where.modality = query.modality;
    if (query.enabled !== undefined) where.enabled = query.enabled;
    if (query.keyword) {
      const keyword = query.keyword.trim();
      if (keyword) {
        where.OR = [
          { title: { contains: keyword } },
          { content: { contains: keyword } },
          { tags: { contains: keyword } },
        ];
      }
    }
    return where;
  }

  private async requirePrompt(id: string) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } });
    if (!prompt) throw new AppError(40400, '提示词不存在', 404);
    return prompt;
  }

  private async toView(prompt: {
    id: string;
    title: string;
    category: string;
    content: string;
    negativePrompt: string;
    modality: string;
    tags: string;
    images: string;
    sortOrder: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const images = await Promise.all(
      parsePromptImages(prompt.images).map(async (image) => ({
        ...image,
        // 解析失败返回空串而不是丢项：运营需要看到「这张图现在打不开」，而不是图凭空消失。
        previewUrl: (await this.settingImages.displayUrl(image.ref)) ?? '',
      })),
    );

    return {
      id: prompt.id,
      title: prompt.title,
      category: prompt.category,
      content: prompt.content,
      negativePrompt: prompt.negativePrompt,
      modality: prompt.modality,
      tags: parsePromptTags(prompt.tags),
      images,
      sortOrder: prompt.sortOrder,
      enabled: prompt.enabled,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    };
  }
}
