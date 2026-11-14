import type { ReactNode } from 'react';

/**
 * 大图查看器的输入契约（从 `ImageLightbox.tsx` 抽出，2026-11-15）。
 *
 * 组件与它的视口状态机（`useLightboxViewport`）都要引用这两个类型，
 * 放进独立文件避免「组件 ↔ hook」互相 import。对外仍由 `ImageLightbox`
 * 再导出 `LightboxItem`，`from './ImageLightbox'` 的既有导入无需改动。
 */
export interface LightboxItem {
  id: string;
  url: string;
  /** 图片替代文本；未传时沿用「生成图预览」 */
  alt?: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  /** 生成时提交的提示词；有值时可在查看器内展开查看与复制 */
  prompt?: string;
  /** 调用方补充的业务元信息；查看器不再自动展示尺寸与创建时间 */
  meta?: string[];
}

export interface ImageLightboxProps {
  items: LightboxItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 无障碍名称，默认「生成图预览」 */
  ariaLabel?: string;
  /** 查看器底栏右侧的业务动作；参数为当前图片索引 */
  renderActions?: (index: number) => ReactNode;
  /**
   * 图片上点右键。传了才接管系统菜单, 不传保持浏览器默认行为 ——
   * 查看器本身不认识「复制 / 下载 / 删除」这类业务动作, 交给调用方决定。
   */
  onItemContextMenu?: (pos: { x: number; y: number }, index: number) => void;
}
