import { describe, expect, it } from 'vitest';

import {
  batchIndexOf,
  buildRows,
  cellState,
  countGenerations,
  downloadFileName,
  formatDate,
  labelOf,
  rowKeyOf,
  sectionCaption,
  textParam,
} from '../utils';
import type { GalleryItem } from '../hooks';

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
      item({ id: 't1', url: '/uploads/out.png', inputUrl: '/uploads/in.png', params: { batchId: 'b1' } }),
    ]);
    expect(rows[0].sourceUrl).toBe('/uploads/in.png');
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
