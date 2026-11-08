import { describe, expect, it } from 'vitest';

import {
  batchIndexOf,
  batchSizeOf,
  buildRows,
  cellState,
  clampCount,
  downloadFileName,
  emptyBatchLabel,
  filterTemplatesByCategory,
  labelOf,
  rowKeyOf,
  templateBeatsText,
} from '../utils';
import type { GalleryItem } from '../hooks';
import {
  DEFAULT_COUNT,
  DEFAULT_LANGUAGE,
  DEFAULT_MARKET,
  DEFAULT_PLATFORM,
  LANGUAGE_OPTIONS,
  MARKET_OPTIONS,
  MAX_COUNT,
  MIN_COUNT,
  PLATFORM_OPTIONS,
  RATIO_OPTIONS,
} from '../constants';

/**
 * AI 带货图文页面的纯函数口径。
 *
 * 锁住四条不变量：
 *   1. 一次生成 = 一行，页签角标按批次计而不是按任务计；
 *   2. 批内顺序按 batchIndex，避免接口返回顺序变化导致「第 1 张 / 第 6 张」错位；
 *   3. 张数在前后端都收敛到 6–10（服务端同样收敛，绕过步进器也拿不到越界值）；
 *   4. 枚举选项与参考站实拍逐项一致（少一项就是 UI 与后端参数对不上）。
 */

function item(overrides: Partial<GalleryItem> & { id: string }): GalleryItem {
  return { url: '', ...overrides } as GalleryItem;
}

describe('模板筛选与展示', () => {
  const templates = [
    { id: 'a', categoryIds: ['apparel'] },
    { id: 'b', categoryIds: ['apparel', 'accessories'] },
    { id: 'c', categoryIds: ['beauty'] },
  ];

  it('空分类 = 全部模板', () => {
    expect(filterTemplatesByCategory(templates, '')).toHaveLength(3);
  });

  it('跨分类模板命中任一分类即入选', () => {
    expect(filterTemplatesByCategory(templates, 'accessories').map((t) => t.id)).toEqual(['b']);
  });

  it('不修改入参', () => {
    const before = templates.map((t) => t.id);
    filterTemplatesByCategory(templates, 'apparel');
    expect(templates.map((t) => t.id)).toEqual(before);
  });

  it('三拍文案用箭头连接', () => {
    expect(templateBeatsText({ beats: ['开箱静物', '多场景上身', '细节收尾'] })).toBe(
      '开箱静物 → 多场景上身 → 细节收尾',
    );
  });
});

describe('生成张数收敛', () => {
  it('低于下界收到 6', () => {
    expect(clampCount(1, MIN_COUNT, MAX_COUNT)).toBe(6);
  });

  it('高于上界收到 10', () => {
    expect(clampCount(999, MIN_COUNT, MAX_COUNT)).toBe(10);
  });

  it('区间内原样保留并取整', () => {
    expect(clampCount(7.6, MIN_COUNT, MAX_COUNT)).toBe(8);
  });

  it('非数字回落到下界', () => {
    expect(clampCount(Number.NaN, MIN_COUNT, MAX_COUNT)).toBe(6);
  });
});

describe('结果批次归组', () => {
  it('同 batchId 归为一行', () => {
    const rows = buildRows([
      item({ id: '1', params: { batchId: 'B', batchIndex: 1 }, url: '/a.png' }),
      item({ id: '2', params: { batchId: 'B', batchIndex: 2 }, url: '/b.png' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(2);
  });

  it('无 batchId 的旧任务各自成行', () => {
    const rows = buildRows([item({ id: '1' }), item({ id: '2' })]);
    expect(rows).toHaveLength(2);
  });

  it('批次张数取 batchSize，部分删除后仍显示原始张数', () => {
    expect(
      batchSizeOf([
        item({ id: '1', params: { batchSize: 6, batchIndex: 3 } }),
        item({ id: '2', params: { batchSize: 6, batchIndex: 4 } }),
      ]),
    ).toBe(6);
  });

  it('没有 batchSize 的旧任务按现存张数计', () => {
    expect(batchSizeOf([item({ id: '1' }), item({ id: '2' })])).toBe(2);
  });

  it('batchSize 非法时回落现存张数', () => {
    expect(batchSizeOf([item({ id: '1', params: { batchSize: 0 } })])).toBe(1);
  });

  it('批内按 batchIndex 升序', () => {
    const rows = buildRows([
      item({ id: 'late', params: { batchId: 'B', batchIndex: 3 } }),
      item({ id: 'early', params: { batchId: 'B', batchIndex: 1 } }),
    ]);
    expect(rows[0].cells.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('任一格未出图即标记 pending（删除按钮需置灰）', () => {
    const rows = buildRows([
      item({ id: '1', url: '/a.png', params: { batchId: 'B', batchIndex: 1 } }),
      item({ id: '2', status: 'running', params: { batchId: 'B', batchIndex: 2 } }),
    ]);
    expect(rows[0].pending).toBe(true);
  });

  it('批内任一张失败不连累整行（失败格保留）', () => {
    const rows = buildRows([
      item({ id: '1', url: '/a.png', params: { batchId: 'B', batchIndex: 1 } }),
      item({ id: '2', status: 'failed', params: { batchId: 'B', batchIndex: 2 } }),
    ]);
    expect(cellState(rows[0].cells[1])).toBe('failed');
    expect(rows[0].pending).toBe(false);
  });
});

describe('格子展示口径', () => {
  it('labelOf 优先 caption', () => {
    expect(labelOf(item({ id: '1', caption: '第 3 张 · 细节收尾' }))).toBe('第 3 张 · 细节收尾');
  });

  it('labelOf 回落 shotIndex', () => {
    expect(labelOf(item({ id: '1', params: { shotIndex: 4 } }))).toBe('第 4 张');
  });

  it('labelOf 拼接拍名（beatLabel 由准入层落库）', () => {
    expect(labelOf(item({ id: '1', params: { shotIndex: 2, beatLabel: '多场景上身' } }))).toBe(
      '第 2 张 · 多场景上身',
    );
  });

  it('labelOf 的 beatLabel 为空时保持「第 N 张」（AI 智能生成）', () => {
    expect(labelOf(item({ id: '1', params: { shotIndex: 5, beatLabel: '' } }))).toBe('第 5 张');
  });

  it('labelOf 无任何信息时给通用名，不返回空', () => {
    expect(labelOf(item({ id: '1' }))).toBe('带货图文');
  });

  it('rowKeyOf 有 batchId 用批次键', () => {
    expect(rowKeyOf(item({ id: 'x', params: { batchId: 'B' } }))).toBe('batch:B');
  });

  it('batchIndexOf 缺省排到最后', () => {
    expect(batchIndexOf(item({ id: '1' }))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('下载文件名带真实格式，不是固定 png', () => {
    expect(downloadFileName(item({ id: 'abcdef123456', format: 'webp' }))).toContain('.webp');
  });
});

describe('历史条无封面时的状态文案', () => {
  it('仍有排队 / 运行中的任务 → 生成中', () => {
    expect(
      emptyBatchLabel([
        item({ id: '1', status: 'running' }),
        item({ id: '2', status: 'failed' }),
      ]),
    ).toBe('生成中');
  });

  it('整批失败 → 失败（不能停留在生成中）', () => {
    expect(
      emptyBatchLabel([
        item({ id: '1', status: 'failed' }),
        item({ id: '2', status: 'failed' }),
      ]),
    ).toBe('失败');
  });

  it('整批取消 → 已取消', () => {
    expect(emptyBatchLabel([item({ id: '1', status: 'cancelled' })])).toBe('已取消');
  });
});

describe('枚举选项与参考站实拍一致', () => {
  it('平台 4 项，默认抖音（本站主动偏离参考站的 TikTok）', () => {
    expect(PLATFORM_OPTIONS.map((o) => o.label)).toEqual(['TikTok', '抖音', '小红书', 'Instagram']);
    expect(DEFAULT_PLATFORM).toBe('douyin');
  });

  it('目标市场 8 项，默认中国（本站主动偏离参考站的美国）', () => {
    expect(MARKET_OPTIONS).toHaveLength(8);
    expect(DEFAULT_MARKET).toBe('cn');
  });

  it('输出语言 8 项，默认中文（本站主动偏离参考站的英文）', () => {
    expect(LANGUAGE_OPTIONS).toHaveLength(8);
    expect(DEFAULT_LANGUAGE).toBe('zh');
  });

  it('画面比例 4 项', () => {
    expect(RATIO_OPTIONS.map((o) => o.value)).toEqual(['1:1', '4:5', '9:16', '3:4']);
  });

  it('张数区间 6–10，默认 6', () => {
    expect(MIN_COUNT).toBe(6);
    expect(MAX_COUNT).toBe(10);
    expect(DEFAULT_COUNT).toBe(6);
  });
});
