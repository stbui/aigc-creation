import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCapabilities } from '../../../lib/capabilities';

import {
  batchIndexOf,
  buildRows,
  cellState,
  countGenerations,
  downloadFileName,
  formSnapshotOf,
  formatDate,
  labelOf,
  resultMetaOf,
  resultStatusOf,
  rowKeyOf,
  sectionCaption,
  textParam,
} from '../utils';
import type { GalleryItem } from '../hooks';

afterEach(() => vi.unstubAllGlobals());

/**
 * 商品详情图「创作结果」归组与展示口径。
 *
 * 锁住四条不变量：
 *   1. **一次生成 = 一行** —— 页签角标按批次计，不按任务计（「6 个模块」不是「6 次」）；
 *   2. **批内顺序按 batchIndex** —— 少了它模块图顺序随接口返回漂移；
 *   3. **原图取任务输入素材**，不是产出素材；
 *   4. **下载扩展名跟真实格式走** —— 厂商链接常常没有后缀，猜后缀会把 PNG 存成 .jpg。
 */

function item(over: Partial<GalleryItem> & { id: string }): GalleryItem {
  return {
    url: '',
    ...over,
  };
}

describe('sectionCaption', () => {
  it('按模块数给出标签', () => {
    expect(sectionCaption({ sections: 'hero,selling_points,usage_scene' })).toBe('3 个模块');
  });

  it('没有 sections 参数时不显示标签', () => {
    expect(sectionCaption({})).toBeUndefined();
  });

  it('sections 为空串时按「无模块」处理', () => {
    expect(sectionCaption({ sections: '' })).toBeUndefined();
  });
});

describe('cellState', () => {
  it('有图就是 ready', () => {
    expect(cellState(item({ id: 't1', url: '/uploads/a.png' }))).toBe('ready');
  });

  it('失败与取消都算 failed', () => {
    expect(cellState(item({ id: 't1', status: 'failed' }))).toBe('failed');
    expect(cellState(item({ id: 't1', status: 'cancelled' }))).toBe('failed');
  });

  it('排队与运行中算 pending', () => {
    expect(cellState(item({ id: 't1', status: 'queued' }))).toBe('pending');
    expect(cellState(item({ id: 't1', status: 'running' }))).toBe('pending');
  });
});

describe('batchIndexOf', () => {
  it('按 batchIndex 升序', () => {
    expect(batchIndexOf(item({ id: 't1', params: { batchIndex: 2 } }))).toBe(2);
  });

  it('缺字段的旧任务排到最后（保持列表原序）', () => {
    expect(batchIndexOf(item({ id: 't1' }))).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('labelOf', () => {
  it('优先用 sectionLabel', () => {
    expect(labelOf(item({ id: 't1', params: { sectionLabel: '首屏主视觉' } }))).toBe('首屏主视觉');
  });

  it('回落任务 caption', () => {
    expect(labelOf(item({ id: 't1', caption: '3 个模块' }))).toBe('3 个模块');
  });

  it('都没有时用「详情图」兜底', () => {
    expect(labelOf(item({ id: 't1' }))).toBe('详情图');
  });
});

describe('textParam', () => {
  it('取非空字符串', () => {
    expect(textParam(item({ id: 't1', params: { productName: ' 沙发 ' } }), 'productName')).toBe('沙发');
  });

  it('非字符串与空串返回 undefined', () => {
    expect(textParam(item({ id: 't1', params: { productName: 42 } }), 'productName')).toBeUndefined();
    expect(textParam(item({ id: 't1', params: { productName: '   ' } }), 'productName')).toBeUndefined();
    expect(textParam(item({ id: 't1' }), 'productName')).toBeUndefined();
  });
});

describe('rowKeyOf / countGenerations', () => {
  it('同批次共享归组键', () => {
    const a = item({ id: 't1', params: { batchId: 'b1' } });
    const b = item({ id: 't2', params: { batchId: 'b1' } });
    expect(rowKeyOf(a)).toBe(rowKeyOf(b));
  });

  it('角标按「次数」计，不按任务数计', () => {
    const items = [
      item({ id: 't1', params: { batchId: 'b1' } }),
      item({ id: 't2', params: { batchId: 'b1' } }),
      item({ id: 't3', params: { batchId: 'b2' } }),
    ];
    expect(countGenerations(items)).toBe(2);
  });

  it('没有 batchId 的旧任务各自成行', () => {
    const items = [item({ id: 't1' }), item({ id: 't2' })];
    expect(countGenerations(items)).toBe(2);
  });
});

describe('buildRows', () => {
  it('按 batchId 归组并按 batchIndex 排序', () => {
    const rows = buildRows([
      item({ id: 't2', params: { batchId: 'b1', batchIndex: 2 } }),
      item({ id: 't1', params: { batchId: 'b1', batchIndex: 1 } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c.id)).toEqual(['t1', 't2']);
  });

  it('原图取任务输入素材，不是产出素材', () => {
    const rows = buildRows([
      item({ id: 't1', url: '/uploads/out.png', inputUrls: ['/uploads/in.png'], params: { batchId: 'b1' } }),
    ]);
    expect(rows[0].sourceUrls).toEqual(['/uploads/in.png']);
  });

  it('批内还有生成中的格子时标记 pending（删除按钮据此置灰）', () => {
    const rows = buildRows([
      item({ id: 't1', url: '/uploads/a.png', params: { batchId: 'b1', batchIndex: 1 } }),
      item({ id: 't2', status: 'running', params: { batchId: 'b1', batchIndex: 2 } }),
    ]);
    expect(rows[0].pending).toBe(true);
  });

  it('全部出图后不再是 pending', () => {
    const rows = buildRows([
      item({ id: 't1', url: '/uploads/a.png', params: { batchId: 'b1' } }),
    ]);
    expect(rows[0].pending).toBe(false);
  });

  it('带出商品名与提示词', () => {
    const rows = buildRows([
      item({
        id: 't1',
        params: { batchId: 'b1', productName: '轻奢沙发', description: ' 弧形设计 ' },
      }),
    ]);
    expect(rows[0].productName).toBe('轻奢沙发');
    expect(rows[0].prompt).toBe('弧形设计');
  });
});

describe('formSnapshotOf', () => {
  it('还原表单参数与原图素材（id 与地址成对）', () => {
    const snapshot = formSnapshotOf([
      item({
        id: 't1',
        params: {
          batchId: 'b1',
          batchIndex: 1,
          productName: ' 轻奢沙发 ',
          brand: ' 品牌A ',
          platform: 'douyin',
          language: 'zh-CN',
          description: ' 弧形设计 ',
          sections: 'hero,usage_scene',
          ratio: '9:16',
          size: '2k',
        },
        inputAssets: [
          { id: 'asset-1', url: '/uploads/a.png', name: 'a.png' },
          { id: 'asset-2', url: '/uploads/b.png' },
        ],
      }),
    ]);

    expect(snapshot).toEqual({
      productName: '轻奢沙发',
      brand: '品牌A',
      platform: 'douyin',
      language: 'zh-CN',
      description: '弧形设计',
      sections: ['hero', 'usage_scene'],
      ratio: '9:16',
      resolution: '2k',
      images: [
        { id: 'asset-1', url: '/uploads/a.png', name: 'a.png' },
        { id: 'asset-2', url: '/uploads/b.png', name: '原图 2' },
      ],
    });
  });

  it('模块清单按固定顺序归一化并剔除已下线项', () => {
    const snapshot = formSnapshotOf([
      item({ id: 't1', params: { sections: 'usage_scene,retired_module,hero' } }),
    ]);
    expect(snapshot?.sections).toEqual(['hero', 'usage_scene']);
  });

  it('兼容旧任务的数组形态模块参数', () => {
    const snapshot = formSnapshotOf([
      item({ id: 't1', params: { sections: ['multi_angle', 'hero'] } }),
    ]);
    expect(snapshot?.sections).toEqual(['hero', 'multi_angle']);
  });

  it('缺参数时返回空串，不沿用当前表单', () => {
    expect(formSnapshotOf([item({ id: 't1' })])).toEqual({
      productName: '',
      brand: '',
      platform: '',
      language: '',
      description: '',
      sections: [],
      ratio: '',
      resolution: '',
      images: [],
    });
  });

  it('没有任务格时返回 null', () => {
    expect(formSnapshotOf([])).toBeNull();
  });
});

describe('resultMetaOf', () => {
  it('把任务参数映射为结果卡第二行文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            message: '',
            data: {
              groups: [],
              workbenchIds: [],
              items: [
                {
                  id: 'main_image',
                  params: [
                    { key: 'platform', options: [{ value: 'douyin', label: '抖音' }] },
                    { key: 'language', options: [{ value: 'zh-CN', label: '简体中文' }] },
                  ],
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await loadCapabilities(true);

    expect(
      resultMetaOf(
        item({
          id: 't1',
          params: { size: '1k', ratio: '9:16', platform: 'douyin', language: 'zh-CN' },
        }),
      ),
    ).toEqual({
      resolution: '1k',
      ratio: '9:16',
      platform: '抖音',
      country: '中国',
      language: '简体中文',
    });
  });

  it('旧任务缺参数时不补默认值', () => {
    expect(resultMetaOf(item({ id: 't1' }))).toEqual({
      resolution: undefined,
      ratio: undefined,
      platform: undefined,
      country: undefined,
      language: undefined,
    });
  });
});

describe('resultStatusOf', () => {
  it('任一任务生成中时显示生成中', () => {
    expect(
      resultStatusOf([
        item({ id: 't1', url: '/uploads/a.png' }),
        item({ id: 't2', status: 'running' }),
      ]),
    ).toEqual({ label: '生成中', tone: 'processing' });
  });

  it('成功与失败并存时显示部分失败', () => {
    expect(
      resultStatusOf([
        item({ id: 't1', url: '/uploads/a.png' }),
        item({ id: 't2', status: 'failed' }),
      ]),
    ).toEqual({ label: '部分失败', tone: 'partial' });
  });

  it('全部失败时显示生成失败', () => {
    expect(resultStatusOf([item({ id: 't1', status: 'failed' })])).toEqual({
      label: '生成失败',
      tone: 'failed',
    });
  });

  it('全部成功时显示已完成', () => {
    expect(resultStatusOf([item({ id: 't1', url: '/uploads/a.png' })])).toEqual({
      label: '已完成',
      tone: 'done',
    });
  });
});

describe('formatDate', () => {
  it('格式化为本地时区的 YYYY-MM-DD HH:mm', () => {
    const date = new Date(2026, 10, 1, 9, 5);
    expect(formatDate(date.toISOString())).toBe('2026-11-01 09:05');
  });

  it('缺值与非法值都不显示', () => {
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('downloadFileName', () => {
  it('扩展名跟真实格式走', () => {
    const name = downloadFileName(item({ id: 'abcdef123456', format: 'jpeg' }));
    expect(name.endsWith('.jpeg')).toBe(true);
  });

  it('缺格式时兜底 png（不猜 jpg）', () => {
    const name = downloadFileName(item({ id: 'abcdef123456' }));
    expect(name.endsWith('.png')).toBe(true);
  });

  it('带上模块名与前缀', () => {
    const name = downloadFileName(
      item({ id: 'abcdef123456', params: { sectionLabel: '首屏主视觉' } }),
      'product-detail',
    );
    expect(name).toContain('product-detail');
    expect(name).toContain('首屏主视觉');
  });
});
