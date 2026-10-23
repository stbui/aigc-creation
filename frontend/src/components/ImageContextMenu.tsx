import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

/**
 * 图片右键菜单 (2026-10-22)。
 *
 * 用途: 在生成图上点右键, 直接「查看大图 / 用作参考图 / 复制地址 / 下载 / 删除」,
 * 不用先点开大图再一个个找按钮。目前只接在自由创作页 (用户明确先只做这一处),
 * 因此不放进全局 App, 由调用方 `createPortal` 到 body 上。
 *
 * 三条实现约束:
 *   1. **portal 到 body**: 结果网格是 `overflow-y: auto` 的滚动容器,
 *      菜单留在原位置会被裁切; portal 之后也不会被 `.pk-workspace` 的高度限制。
 *   2. **坐标夹进视口**: 右边缘/下边缘右键时菜单会自动往回收, 而不是溢出屏幕。
 *   3. **键盘可用**: ↑/↓ 移动, Enter 执行, Esc 关闭; 点空白 / 滚动 / 缩放窗口也关闭
 *      —— 菜单浮在固定位置, 页面一动它就不该还停在那儿。
 *
 * 不做「右键菜单里再嵌子菜单」: 这组动作是线性的, 嵌套只会让点击路径变长。
 */
export interface ImageMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** 破坏性动作 (删除): 文字标红, 与其它项之间画分隔线 */
  danger?: boolean;
  /** 在该项上方画一条分隔线 */
  divider?: boolean;
  onSelect: () => void;
}

interface ImageContextMenuProps {
  /** 右键位置 (视口坐标, 即 clientX / clientY) */
  x: number;
  y: number;
  items: ImageMenuItem[];
  onClose: () => void;
}

/** 菜单与视口边缘的最小间距 */
const VIEW_MARGIN = 8;

export function ImageContextMenu({ x, y, items, onClose }: ImageContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);

  // 先渲染再测量, 把菜单收回视口内 (右下角右键时最常见)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(VIEW_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEW_MARGIN)),
      y: Math.max(VIEW_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEW_MARGIN)),
    });
  }, [x, y]);

  // 打开即聚焦, 键盘可直接操作
  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      // 菜单内部的按下不关闭: 交给按钮自己的 onClick 处理
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      /*
       * 这里是 window 的**捕获**监听, 处理完必须 stopPropagation:
       * 菜单常常开在整屏查看器上, 而查看器自己也监听 Esc / ←→,
       * 不截住的话按一次 Esc 会连菜单带查看器一起关掉。
       */
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        handled();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        handled();
        const n = items.length;
        if (n === 0) return;
        setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
        return;
      }
      // ←/→ 在查看器里是翻页。菜单开着时一并吞掉: 否则图切了, 菜单还指着上一张,
      // 「删除」就会删到用户以为没选中的那张。
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        handled();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && active >= 0) {
        const item = items[active];
        if (!item) return;
        handled();
        item.onSelect();
        onClose();
      }
    };
    // 任何一处滚动 (结果网格、大图查看器) 都让菜单关闭: 它锚在视口坐标上, 页面动了就失准
    const onViewportChange = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [active, items, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="img-context-menu"
      role="menu"
      aria-label="图片操作"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {item.divider && <div className="img-context-sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={`img-context-item${item.danger ? ' is-danger' : ''}${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
            >
              {Icon ? <Icon size={15} /> : <span className="img-context-icon-gap" />}
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
