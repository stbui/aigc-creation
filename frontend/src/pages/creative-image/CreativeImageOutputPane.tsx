import { ImagePlus } from 'lucide-react';

import { ResultGalleryPane } from './components';
import type { GalleryItem } from './hooks';

interface CreativeImageOutputPaneProps {
  generating: boolean;
  submitting: boolean;
  items: GalleryItem[];
  loading: boolean;
  error: string | null;
  /** 最近一次生成失败的文案；null 表示不展示提示行 */
  failureNotice: string | null;
  loggedIn: boolean;
  onRefresh: () => void;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
  downloadNamePrefix: string;
}

/**
 * 右栏结果区：本页能力的全部成功产出。
 *
 * 网格 / 大图 / 右键菜单由 `ResultGalleryPane` 渲染（与商品主图页共用），
 * 本页只补「用作参考图」这一条独有动作。
 */
export function CreativeImageOutputPane({
  generating,
  submitting,
  items,
  loading,
  error,
  failureNotice,
  loggedIn,
  onRefresh,
  onDelete,
  onUseAsReference,
  downloadNamePrefix,
}: CreativeImageOutputPaneProps) {
  return (
    <ResultGalleryPane
      title={generating ? '生成中…' : '全部生成图'}
      items={items}
      loading={loading}
      error={error}
      notice={
        failureNotice ? (
          <p className="tool-submit-notice tool-submit-notice-error">最近一次生成失败：{failureNotice}</p>
        ) : null
      }
      pending={submitting ? [{ key: 'pending' }] : []}
      emptyTitle="效果图预览"
      emptyDesc={
        loggedIn
          ? '提交任务后，生成结果将在此处展示，本页生成过的图片都会保留在这里'
          : '登录后，你在这个页面生成过的图片都会显示在这里'
      }
      onRefresh={onRefresh}
      onDelete={onDelete}
      extraActions={(item) => [
        {
          key: 'reference',
          label: '用作参考图',
          icon: ImagePlus,
          onSelect: () => onUseAsReference(item),
        },
      ]}
      downloadNamePrefix={downloadNamePrefix}
    />
  );
}
