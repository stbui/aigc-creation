import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom 环境补齐。
 *
 * React Testing Library 在 vitest 未开 `globals` 时不会自动注册 cleanup，
 * 这里显式清理，避免同一文件内的用例互相看到对方渲染的 DOM。
 *
 * 其余 mock 是 antd / 响应式组件在 jsdom 下的必需品：jsdom 没实现
 * matchMedia、ResizeObserver 与 scrollIntoView，不补会在渲染时抛
 * "not a function"，让组件测试看起来像业务回归。
 */
afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (!('ResizeObserver' in window)) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
}

if (!window.scrollTo) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}

/*
 * 指针捕获（pointer capture）补齐。
 *
 * jsdom 没有实现 `hasPointerCapture` / `setPointerCapture` /
 * `releasePointerCapture`。radix-ui 的 `Select` 在打开浮层时调用这三个方法
 * 来跟踪指针 —— 不补会在点击下拉时抛
 * "target.hasPointerCapture is not a function"，把用例变成「组件坏了」。
 *
 * 真实浏览器里这三个方法只用于「指针按在浮层外时仍继续收事件」，jsdom 里
 * 没有真实指针，桩实现返回 false 即可。
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as Element['hasPointerCapture'];
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn() as unknown as Element['setPointerCapture'];
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture =
    vi.fn() as unknown as Element['releasePointerCapture'];
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
}
