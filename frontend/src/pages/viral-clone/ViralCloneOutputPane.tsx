import { OutputTabsPane } from './components';
import type { GalleryItem, RightTab, UploadedImage } from './hooks';
import type { PolledResult } from './utils';
import { ViralCloneExamplePanel } from './ViralCloneExamplePanel';
import { ViralCloneResultList } from './ViralCloneResultList';

/**
 * 爆款复刻工作台右栏：功能示例 / 创作结果 两个页签。
 *
 * 与商品详情 / 商品主图右栏完全同构（共用的 `OutputTabsPane` 外壳）。
 * 创作结果保留本页特有的「商品图 → 参考图 → 生成图」对照行。右栏不取数：
 * 结果轮询与页签落位（`useResultGallery` / `useRightTab`）都在 `page.tsx`，
 * 提交后把页签切到「创作结果」也由页面统一驱动。
 */
export interface ViralCloneOutputPaneProps {
  rightTab: RightTab;
  onPickTab: (tab: RightTab) => void;
  /** 页签角标：按生成次数计，与下方列表行数一致 */
  generationCount: number;

  // ── 创作结果 ──
  items: GalleryItem[];
  loading: boolean;
  /** 加载失败信息；非空时保留已有列表并提示 */
  error?: string | null;
  submitting: boolean;
  images: UploadedImage[];
  reference: UploadedImage | null;
  result: PolledResult | null;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
}

export function ViralCloneOutputPane({
  rightTab,
  onPickTab,
  generationCount,
  items,
  loading,
  error,
  submitting,
  images,
  reference,
  result,
  onDelete,
  onUseAsReference,
}: ViralCloneOutputPaneProps) {
  return (
    <OutputTabsPane
      value={rightTab}
      onChange={onPickTab}
      generationCount={generationCount}
      demo={<ViralCloneExamplePanel />}
      results={
        <ViralCloneResultList
          items={items}
          loading={loading}
          error={error}
          submitting={submitting}
          images={images}
          reference={reference}
          result={result}
          onDelete={onDelete}
          onUseAsReference={onUseAsReference}
        />
      }
    />
  );
}
