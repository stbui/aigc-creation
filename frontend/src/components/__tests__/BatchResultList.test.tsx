import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { UiProvider } from '../../ui';
import { buildBatchRows } from '../batchResult';
import { BatchResultList } from '../BatchResultList';
import type { GalleryItem } from '../../hooks/useResultGallery';

/**
 * 批次结果列表是详情图 / 商品主图 / 带货图文三页共用的渲染本体。
 * 这里锁住共用部分的行为：空态、计数、行头插槽、格子的三种状态，
 * 以及删除与预览入口 —— 页面差异全部走插槽，组件内不该出现页面判断。
 */

function item(over: Partial<GalleryItem> & Pick<GalleryItem, 'id'>): GalleryItem {
  return { url: '', status: 'succeeded', params: { batchId: 'b1', batchIndex: 1 }, ...over } as GalleryItem;
}

const keyOf = (entry: GalleryItem) => String(entry.params?.batchId);
const labelOf = (entry: GalleryItem) => entry.caption || '详情图';

function rowsOf(items: GalleryItem[]) {
  return buildBatchRows<{ prompt?: string }>(
    items,
    (entry) => ({ prompt: typeof entry.params?.description === 'string' ? entry.params.description : undefined }),
    keyOf,
  );
}

type Row = ReturnType<typeof rowsOf>[number];

interface ListOverrides {
  rows?: Row[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  layout?: 'strip' | 'card';
  cellLabelOf?: (entry: GalleryItem, index: number) => string;
  renderRowTitle?: (row: Row) => ReactNode;
  renderRowMeta?: (row: Row) => ReactNode;
  renderSourceCaption?: (row: Row) => ReactNode;
}

function renderList(over: ListOverrides = {}) {
  const onRefresh = vi.fn();
  const onDeleteRow = vi.fn();
  render(
    <UiProvider>
      <BatchResultList
        rows={over.rows ?? rowsOf([item({ id: 't1', url: '/uploads/a.png', caption: '首屏图' })])}
        loading={over.loading ?? false}
        title="生成记录"
        emptyTitle={over.emptyTitle ?? '效果图预览'}
        emptyDesc={over.emptyDesc}
        emptyChildren={over.emptyChildren}
        onRefresh={onRefresh}
        onDeleteRow={onDeleteRow}
        downloadNamePrefix="demo"
        labelOf={labelOf}
        layout={over.layout}
        cellLabelOf={over.cellLabelOf}
        renderRowTitle={over.renderRowTitle}
        renderRowMeta={over.renderRowMeta}
        renderSourceCaption={over.renderSourceCaption ?? (() => '商品原图')}
      />
    </UiProvider>,
  );
  return { onRefresh, onDeleteRow };
}

describe('BatchResultList 空态与加载', () => {
  it('没有结果时展示空态并带上自定义内容', () => {
    renderList({ rows: [], emptyDesc: '提交后在此查看', emptyChildren: <span>步骤一</span> });
    expect(screen.getByText('效果图预览')).toBeVisible();
    expect(screen.getByText('提交后在此查看')).toBeVisible();
    expect(screen.getByText('步骤一')).toBeVisible();
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
  });

  it('首次加载中不展示空态', () => {
    renderList({ rows: [], loading: true });
    expect(screen.queryByText('效果图预览')).not.toBeInTheDocument();
  });
});

describe('BatchResultList 批次行', () => {
  it('按批次展示计数与行头插槽', () => {
    renderList({
      rows: rowsOf([
        item({
          id: 't1',
          url: '/uploads/a.png',
          caption: '首屏图',
          createdAt: '2026-11-01T09:05:00.000Z',
          params: { batchId: 'b1', batchIndex: 1, description: '清晨窗边的木质桌面' },
        }),
        item({ id: 't2', status: 'running', params: { batchId: 'b1', batchIndex: 2 } }),
      ]),
      renderRowMeta: (row) => (row.prompt ? <span>提示词：{row.prompt}</span> : null),
    });

    // 计数由多个文本节点拼成, 按整段文本断言
    const count = document.querySelector('.pk-result-count');
    // 两个同批次任务合成一行: 「1 次」, 其中 1 张已出图
    expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 次 · 1 张');
    expect(screen.getByText('提示词：清晨窗边的木质桌面')).toBeVisible();
    // 第二格还在生成中: 展示占位而不是下载入口
    expect(screen.getByText('生成中…')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '下载首屏图结果图' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '下载详情图结果图' })).not.toBeInTheDocument();
  });

  it('批内仍有未出图的格子时禁用删除', () => {
    const { onDeleteRow } = renderList({
      rows: rowsOf([
        item({ id: 't1', url: '/uploads/a.png' }),
        item({ id: 't2', status: 'queued', params: { batchId: 'b1', batchIndex: 2 } }),
      ]),
    });

    const del = screen.getByRole('button', { name: '删除这次生成的全部图片' });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(onDeleteRow).not.toHaveBeenCalled();
  });

  it('全部出图后删除会把整批任务交回页面', () => {
    const { onDeleteRow } = renderList({
      rows: rowsOf([
        item({ id: 't1', url: '/uploads/a.png' }),
        item({ id: 't2', url: '/uploads/b.png', params: { batchId: 'b1', batchIndex: 2 } }),
      ]),
    });

    fireEvent.click(screen.getByRole('button', { name: '删除这次生成的全部图片' }));
    expect(onDeleteRow).toHaveBeenCalledTimes(1);
    expect(onDeleteRow.mock.calls[0][0].map((entry: GalleryItem) => entry.id)).toEqual(['t1', 't2']);
  });

  it('刷新按钮在加载中禁用', () => {
    renderList({ loading: true });
    expect(screen.getByRole('button', { name: '刷新中' })).toBeDisabled();
  });
});

describe('BatchResultList 单元格交互', () => {
  it('原图与产出图都能打开查看器', () => {
    renderList({
      rows: rowsOf([
        item({
          id: 't1',
          url: '/uploads/out.png',
          caption: '首屏图',
          inputUrls: ['/uploads/src.png'],
          params: { batchId: 'b1', batchIndex: 1 },
        }),
      ]),
    });

    fireEvent.click(screen.getByRole('button', { name: '查看商品原图大图' }));
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '关闭预览' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看首屏图大图' }));
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeVisible();
  });

  it('下载文件名 = 页面前缀 + 格名称 + 任务尾号', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderList({
      rows: rowsOf([item({ id: 'abcdef123456', url: '/uploads/a.png', caption: '首屏图', format: 'jpeg' })]),
    });

    const cell = screen.getByRole('button', { name: '查看首屏图大图' }).closest('figure') as HTMLElement;
    fireEvent.click(within(cell).getByRole('button', { name: '下载首屏图结果图' }));

    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('demo-首屏图-123456.jpeg');
    click.mockRestore();
  });
});

describe('BatchResultList 卡片布局', () => {
  it('按标题、参数、原图与三列图片分层展示', () => {
    const rows = rowsOf([
      item({
        id: 't1',
        url: '/uploads/a.png',
        inputUrls: ['/uploads/src.png'],
        params: { batchId: 'b1', batchIndex: 1, description: '轻奢沙发' },
      }),
      item({ id: 't2', url: '/uploads/b.png', params: { batchId: 'b1', batchIndex: 2 } }),
      item({ id: 't3', url: '/uploads/c.png', params: { batchId: 'b1', batchIndex: 3 } }),
    ]);

    renderList({
      rows,
      layout: 'card',
      cellLabelOf: (_, index) => `图片 ${index + 1}`,
      renderRowTitle: (row) => (
        <>
          <strong>{row.prompt}</strong>
          <time>2026-11-05 10:00</time>
        </>
      ),
      renderRowMeta: () => (
        <>
          <span>1k</span>
          <span>9:16</span>
          <span>已完成</span>
        </>
      ),
      renderSourceCaption: () => '轻奢沙发',
    });

    expect(screen.getByText('轻奢沙发')).toBeVisible();
    expect(screen.getByText('2026-11-05 10:00')).toBeVisible();
    expect(screen.getByText('1k')).toBeVisible();
    expect(screen.getByText('9:16')).toBeVisible();
    expect(screen.queryByText('本地原图')).not.toBeInTheDocument();
    expect(document.querySelector('.pd-result-card-source img')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键下载本批次 3 张结果图' })).toBeEnabled();

    const grid = document.querySelector('.pd-result-card-grid');
    expect(grid).toBeInTheDocument();
    expect(grid?.querySelectorAll('.pd-result-cell')).toHaveLength(3);
    expect(within(grid as HTMLElement).getByText('图片 1')).toBeVisible();
    expect(within(grid as HTMLElement).getByText('图片 3')).toBeVisible();
  });

  it('一键下载会依次触发本批次全部已完成图片', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderList({
      rows: rowsOf([
        item({ id: 'ready001', url: '/uploads/a.png' }),
        item({ id: 'ready002', url: '/uploads/b.png', params: { batchId: 'b1', batchIndex: 2 } }),
      ]),
      layout: 'card',
      cellLabelOf: (_, index) => `图片 ${index + 1}`,
    });

    fireEvent.click(screen.getByRole('button', { name: '一键下载本批次 2 张结果图' }));

    expect(click).toHaveBeenCalledTimes(2);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('demo-图片 1-ady001.png');
    expect((click.mock.instances[1] as HTMLAnchorElement).download).toBe('demo-图片 2-ady002.png');
    click.mockRestore();
  });

  it('默认布局仍是横向单行，不受详情卡片样式影响', () => {
    renderList();
    expect(document.querySelector('.pd-result-card')).not.toBeInTheDocument();
    expect(document.querySelector('.pd-result-strip')).toBeInTheDocument();
  });
});
