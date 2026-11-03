import { useEffect } from 'react';

let activeLocks = 0;
let originalOverflow = '';
let originalPaddingRight = '';

function scrollbarWidth() {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
}

/**
 * 锁定 body 滚动，并补齐滚动条消失后腾出的宽度。
 *
 * 全局不预留 scrollbar gutter，避免无滚动页面右侧出现空白；弹窗打开时如果
 * 不补 padding，页面会横向跳动。引用计数保证嵌套弹层只恢复一次原始样式。
 */
export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {};

  if (activeLocks === 0) {
    const body = document.body;
    originalOverflow = body.style.overflow;
    originalPaddingRight = body.style.paddingRight;

    const gutter = scrollbarWidth();
    const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${currentPadding + gutter}px`;
  }

  activeLocks += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeLocks -= 1;

    if (activeLocks === 0) {
      const body = document.body;
      body.style.overflow = originalOverflow;
      body.style.paddingRight = originalPaddingRight;
    }
  };
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    return lockBodyScroll();
  }, [locked]);
}
