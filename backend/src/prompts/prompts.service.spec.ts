import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../common/app.exception';
import {
  normalizePromptImages,
  normalizePromptTags,
  parsePromptImages,
  parsePromptTags,
  PromptsService,
} from './prompts.service';

describe('提示词标签', () => {
  it('解析 JSON 数组；坏数据回落空数组', () => {
    expect(parsePromptTags('["人像","棚拍"]')).toEqual(['人像', '棚拍']);
    expect(parsePromptTags(null)).toEqual([]);
    expect(parsePromptTags('not-json')).toEqual([]);
    expect(parsePromptTags('[1,"ok",""]')).toEqual(['ok']);
  });

  it('归一化：去空白、去重、单条截断、最多 8 条', () => {
    const raw = [' 人像 ', '人像', '', ...Array.from({ length: 10 }, (_, i) => `标签${i}`)];
    const parsed = parsePromptTags(normalizePromptTags(raw));
    expect(parsed).toHaveLength(8);
    expect(parsed[0]).toBe('人像');
    expect(new Set(parsed).size).toBe(parsed.length);
    expect(parsePromptTags(normalizePromptTags(['一'.repeat(30)]))[0]).toHaveLength(20);
  });
});

describe('提示词配图', () => {
  it('解析：丢弃空 ref 与坏数据，保留可追溯字段', () => {
    expect(parsePromptImages(null)).toEqual([]);
    expect(parsePromptImages('not-json')).toEqual([]);
    expect(parsePromptImages('{"a":1}')).toEqual([]);
    expect(
      parsePromptImages(
        JSON.stringify([
          { ref: ' storage://local/prompts/a.jpg ', assetId: 'a1', name: '图一' },
          { ref: '' },
          { assetId: 'only-id' },
        ]),
      ),
    ).toEqual([{ ref: 'storage://local/prompts/a.jpg', assetId: 'a1', name: '图一' }]);
  });

  it('归一化：按 ref 去重，限制最多 9 张', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ ref: `storage://local/p${i}.jpg` }));
    raw.push({ ref: 'storage://local/p0.jpg' });
    const parsed = parsePromptImages(normalizePromptImages(raw));
    expect(parsed).toHaveLength(9);
    expect(new Set(parsed.map((item) => item.ref)).size).toBe(9);
  });
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/** 与 prisma.prompt 的行形状对齐；测试只关心 images 与展示字段。 */
function promptRow(images: Array<{ ref: string }>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    title: '标题',
    category: '',
    content: '正文',
    negativePrompt: '',
    modality: 'image',
    tags: '[]',
    images: JSON.stringify(images),
    sortOrder: 0,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PromptsService', () => {
  let prisma: Record<string, any>;
  let provider: { backend: string; put: any; delete: any };
  let storage: Record<string, any>;
  let service: PromptsService;

  beforeEach(() => {
    prisma = {
      prompt: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    const settingImages = {
      toReference: vi.fn((backend: string, key: string) => `storage://${backend}/${key}`),
      displayUrl: vi.fn(async (ref: string) => `https://cdn.test/${ref}`),
    };
    provider = {
      backend: 'local',
      put: vi.fn(async (key: string, data: Buffer, contentType: string) => ({
        key,
        sizeBytes: data.length,
        contentType,
      })),
      delete: vi.fn(async () => undefined),
    };
    storage = {
      getActive: vi.fn(() => provider),
      get: vi.fn(() => provider),
      buildKey: vi.fn(() => 'prompts/202611/abc.jpg'),
    };
    const settings = { uploadLimits: vi.fn(async () => ({})) };
    service = new PromptsService(
      prisma as never,
      settingImages as never,
      storage as never,
      settings as never,
    );
  });

  it('列表按启用状态过滤，enabled=false 不能丢', async () => {
    await service.list({ enabled: false } as never);
    const where = prisma.prompt.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ enabled: false });
  });

  it('关键词同时匹配标题、正文与标签', async () => {
    await service.list({ keyword: '霓虹' } as never);
    const where = prisma.prompt.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: '霓虹' } },
      { content: { contains: '霓虹' } },
      { tags: { contains: '霓虹' } },
    ]);
  });

  it('正文为空返回 400；标题可为空', async () => {
    const noContent = await service.create({ title: 'x', content: ' ' } as never).catch((e) => e);
    expect(noContent).toBeInstanceOf(AppError);
    expect((noContent as AppError).code).toBe(40001);
    expect(prisma.prompt.create).not.toHaveBeenCalled();

    prisma.prompt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'p1',
        images: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    );
    const view = await service.create({ content: ' 白底商品图 ', title: '  ' } as never);
    expect(prisma.prompt.create.mock.calls[0][0].data).toMatchObject({
      title: '',
      content: '白底商品图',
    });
    expect(view.title).toBe('');
  });

  it('创建时补齐默认值并归一化标签与配图', async () => {
    prisma.prompt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'p1',
        images: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }),
    );

    await service.create({
      content: ' 白底商品图 ',
      tags: [' 电商 ', '电商'],
      images: [{ ref: 'storage://local/prompts/a.jpg' }, { ref: 'storage://local/prompts/a.jpg' }],
    } as never);

    expect(prisma.prompt.create.mock.calls[0][0].data).toMatchObject({
      category: '',
      negativePrompt: '',
      modality: 'image',
      tags: '["电商"]',
      images: '[{"ref":"storage://local/prompts/a.jpg"}]',
      sortOrder: 0,
      enabled: true,
    });
  });

  it('更新不存在的提示词返回 404，且不写库', async () => {
    prisma.prompt.findUnique.mockResolvedValue(null);
    const error = await service.update('missing', { title: 'x' } as never).catch((e) => e);
    expect((error as AppError).code).toBe(40400);
    expect(prisma.prompt.update).not.toHaveBeenCalled();
  });

  it('上传空文件列表返回 400', async () => {
    const error = await service.uploadImages([]).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(40001);
  });

  it('multer 落盘后按 path 读取文件并写入存储', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompt-spec-'));
    const file = join(dir, 'a.png');
    await writeFile(file, PNG_1X1);

    try {
      const result = await service.uploadImages([{ path: file, originalname: ' a.png ' }]);
      expect(provider.put).toHaveBeenCalledWith(
        'prompts/202611/abc.jpg',
        PNG_1X1,
        'image/png',
      );
      expect(result.items[0]).toMatchObject({
        ref: 'storage://local/prompts/202611/abc.jpg',
        width: 1,
        height: 1,
        name: 'a.png',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('删除提示词后回收本接口上传的配图对象', async () => {
    prisma.prompt.findUnique.mockResolvedValue(
      promptRow([
        { ref: 'storage://local/prompts/202611/a.jpg' },
        { ref: 'storage://local/original/from-asset.jpg' },
      ]),
    );

    await service.remove('p1');

    expect(prisma.prompt.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    // 素材库前缀不能被连带删除
    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledWith('prompts/202611/a.jpg');
  });

  it('配图被其它提示词引用时不删对象', async () => {
    prisma.prompt.findUnique.mockResolvedValue(
      promptRow([{ ref: 'storage://local/prompts/202611/a.jpg' }]),
    );
    prisma.prompt.count.mockResolvedValue(1);

    await service.remove('p1');

    expect(provider.delete).not.toHaveBeenCalled();
  });

  it('回收过程失败不影响已成功的删除', async () => {
    prisma.prompt.findUnique.mockResolvedValue(
      promptRow([{ ref: 'storage://local/prompts/202611/a.jpg' }]),
    );
    prisma.prompt.count.mockRejectedValue(new Error('count failed'));

    await expect(service.remove('p1')).resolves.toEqual({ id: 'p1', title: '标题' });
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it('更新时只回收被移出的配图；保存失败不删对象', async () => {
    prisma.prompt.findUnique.mockResolvedValue(
      promptRow([
        { ref: 'storage://local/prompts/202611/a.jpg' },
        { ref: 'storage://local/prompts/202611/b.jpg' },
      ]),
    );
    prisma.prompt.update.mockResolvedValue(
      promptRow([{ ref: 'storage://local/prompts/202611/a.jpg' }]),
    );

    await service.update('p1', { images: [{ ref: 'storage://local/prompts/202611/a.jpg' }] });

    expect(provider.delete).toHaveBeenCalledTimes(1);
    expect(provider.delete).toHaveBeenCalledWith('prompts/202611/b.jpg');
  });

  it('更新写库失败时保留原有配图对象', async () => {
    prisma.prompt.findUnique.mockResolvedValue(
      promptRow([
        { ref: 'storage://local/prompts/202611/a.jpg' },
        { ref: 'storage://local/prompts/202611/b.jpg' },
      ]),
    );
    prisma.prompt.update.mockRejectedValue(new Error('db down'));

    await expect(service.update('p1', { title: 'x' })).rejects.toThrow('db down');
    expect(provider.delete).not.toHaveBeenCalled();
  });
});
