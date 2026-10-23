import { useEffect } from 'react';
import { registerUnsavedGuard } from '../lib/unsaved-guard';

/**
 * 有未保存变更时拦截离开。
 *
 * 两件事:
 *   1. `beforeunload` —— 刷新 / 关闭标签页 / 地址栏跳站外时由浏览器弹原生确认。
 *   2. 登记到 `unsaved-guard` —— 站内 SPA 跳转由外壳 (AdminLayout) 拦截并弹确认框。
 *
 * 只传 `dirty` 即可; 组件卸载时自动注销，不会留下"幽灵守卫"把后续跳转全拦下来。
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerUnsavedGuard(() => true);

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 部分浏览器 (Chrome ≥ 119) 忽略自定义文案, 但必须给 returnValue 才会弹
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);

    return () => {
      unregister();
      window.removeEventListener('beforeunload', handler);
    };
  }, [dirty]);
}
