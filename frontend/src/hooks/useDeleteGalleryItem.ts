import { useCallback } from 'react';
import { generateApi } from '../lib/api';
import { useApp } from '../ui';
import type { GalleryItem } from './useResultGallery';

interface Options {
  /** 结果列表；删除成功后从本地摘掉，不再重拉 */
  removeItem: (id: string) => void;
  /** 删除成功后的连带清理（如产出素材正占着参考图位） */
  onDeleted?: (item: GalleryItem) => void;
}

/**
 * 删除单张生成图 —— 确认框 + 接口 + 本地摘除 + 连带清理。
 *
 * `DELETE /tasks/:id` 会连带删掉产出素材与磁盘文件，删除不可逆；
 * 用户此时看到的是缩略图，未必意识到「作品记录」也一起没了，故必须二次确认。
 */
export function useDeleteGalleryItem({ removeItem, onDeleted }: Options) {
  const { message, modal } = useApp();

  return useCallback(
    (item: GalleryItem) => {
      modal.confirm({
        title: '删除这张作品？',
        content: '生成图与本地文件会一并删除，不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await generateApi.remove(item.id);
            removeItem(item.id);
            onDeleted?.(item);
            message.success('已删除作品及其生成图');
          } catch (e) {
            message.error((e as Error).message || '删除失败');
          }
        },
      });
    },
    [message, modal, onDeleted, removeItem],
  );
}
