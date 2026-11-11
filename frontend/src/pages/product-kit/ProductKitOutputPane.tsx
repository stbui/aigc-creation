import type { ReactNode } from 'react';

import type { GalleryItem, RightTab } from './hooks';
import { ProductKitExamplePanel } from './ProductKitExamplePanel';
import { ProductKitResultList } from './ProductKitResultList';

/**
 * 商品主图工作台右栏：功能示例 / 创作结果 两个页签。
 *
 * 创作结果按批次逐行陈列（一次生成一行，原图 + 各变体主图）。右栏不取数：
 * 结果轮询与页签落位（`useResultGallery` / `useRightTab`）都在 `page.tsx`，
 * 提交后把页签切到「创作结果」也由页面统一驱动。
 */
export interface ProductKitOutputPaneProps {
  rightTab: RightTab;
  onPickTab: (tab: RightTab) => void;
  /** 页签角标：按生成次数计，与下方批次行数一致 */
  generationCount: number;

  // ── 创作结果 ──
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息；非空时保留已有列表并提示 */
  error?: string | null;
  emptyDesc?: string;
  emptyChildren?: ReactNode;
  /** 删除一次生成（批次内全部任务） */
  onDeleteRow: (items: GalleryItem[]) => void;
  downloadNamePrefix?: string;
}

export function ProductKitOutputPane({
  rightTab,
  onPickTab,
  generationCount,
  items,
  loading,
  error,
  emptyDesc,
  emptyChildren,
  onDeleteRow,
  downloadNamePrefix = 'main-image',
}: ProductKitOutputPaneProps) {
  return (
    <section className="pd-right-pane">
      <div className="pd-tabs" role="tablist" aria-label="右侧面板">
        <button
          type="button"
          role="tab"
          id="pk-tab-demo"
          aria-selected={rightTab === 'demo'}
          aria-controls="pk-panel-demo"
          className={rightTab === 'demo' ? 'is-active' : ''}
          onClick={() => onPickTab('demo')}
        >
          功能示例
        </button>
        <button
          type="button"
          role="tab"
          id="pk-tab-results"
          aria-selected={rightTab === 'results'}
          aria-controls="pk-panel-results"
          className={rightTab === 'results' ? 'is-active' : ''}
          onClick={() => onPickTab('results')}
        >
          创作结果
          {generationCount > 0 && <span className="pd-tab-count">{generationCount}</span>}
        </button>
      </div>

      <div className="pd-right-body">
        {rightTab === 'demo' ? (
          <div role="tabpanel" id="pk-panel-demo" aria-labelledby="pk-tab-demo" className="pd-right-panel">
            <ProductKitExamplePanel />
          </div>
        ) : (
          <div role="tabpanel" id="pk-panel-results" aria-labelledby="pk-tab-results" className="pd-right-panel">
            <ProductKitResultList
              items={items}
              loading={loading}
              error={error}
              emptyTitle="效果图预览"
              emptyDesc={emptyDesc}
              emptyChildren={emptyChildren}
              onDeleteRow={onDeleteRow}
              downloadNamePrefix={downloadNamePrefix}
            />
          </div>
        )}
      </div>
    </section>
  );
}
