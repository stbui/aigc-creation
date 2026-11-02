import { ImagePlus } from 'lucide-react';

import type { PkResult } from './constants';
import {
  ResultGalleryPane,
  ToolWorkflowSteps,
  type ImageMenuItem,
} from './components';
import type { GalleryItem, ResultGallery } from './hooks';
import { taskErrorText } from './utils';

/**
 * 右侧结果栏（本能力全部生成图）。
 *
 * 与创意生图页同构：用户可以并排比较「参考风格」与「高度复刻」两档的差异；
 * 本次出图由 `gallery.prepend` 插到榜首，生成中画一张占位卡。
 */
export function ViralCloneResultPane({
  token,
  gallery,
  generating,
  submitting,
  result,
  onRefresh,
  onDelete,
  onUseAsReference,
}: {
  token: string | null;
  gallery: Pick<ResultGallery, 'items' | 'loading' | 'error' | 'reload'>;
  generating: boolean;
  submitting: boolean;
  result: PkResult | null;
  onRefresh: () => void;
  onDelete: (item: GalleryItem) => void;
  onUseAsReference: (item: GalleryItem) => void;
}) {
  return (
    <ResultGalleryPane
      title={generating ? '生成中…' : '全部生成图'}
      items={gallery.items}
      loading={gallery.loading}
      error={gallery.error}
      notice={
        result && result.status === 'failed' ? (
          <p className="tool-submit-notice tool-submit-notice-error">
            本次生成失败：{taskErrorText(result.errorCode)}，可重新生成
          </p>
        ) : null
      }
      pending={submitting ? [{ key: 'clone', label: '爆款复刻图' }] : []}
      emptyTitle="效果图预览"
      emptyDesc={
        token
          ? '提交任务后，生成结果将在此处展示，本页生成过的图都会保留在这里'
          : '登录后，你在这个页面生成过的图都会显示在这里'
      }
      emptyChildren={<ToolWorkflowSteps />}
      onRefresh={onRefresh}
      onDelete={onDelete}
      extraActions={(item): ImageMenuItem[] => [
        {
          key: 'reference',
          label: '用作参考图',
          icon: ImagePlus,
          onSelect: () => onUseAsReference(item),
        },
      ]}
      downloadNamePrefix="viral-clone"
    />
  );
}
