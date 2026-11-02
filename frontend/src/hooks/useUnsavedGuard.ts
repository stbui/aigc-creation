import { useCallback, useEffect } from 'react';
import { registerUnsavedGuard } from '../lib/unsaved-guard';
import { useOptionalConfirm } from '../admin-ui/providers/ConfirmProvider';

/**
 * 有未保存变更时拦截离开。
 *
 * 两件事:
 *   1. `beforeunload` —— 刷新 / 关闭标签页 / 地址栏跳站外时由浏览器弹原生确认。
 *   2. 登记到 `unsaved-guard` —— 站内 SPA 跳转由外壳拦截并弹确认框。
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

/**
 * 抽屉 / 表单关闭前的丢弃确认。
 *
 * `useUnsavedGuard` 负责路由跳转与刷新，但关闭抽屉不会触发路由变化。
 * 有修改时先问一句，没有修改则直接关闭。
 *
 * 确认走 `ConfirmProvider`（后台已挂载）。Provider 不在时退回
 * 浏览器原生 `confirm` —— 不能让「问一句」这件事本身依赖某个外壳，
 * 更不能因为没有 Provider 就白屏。
 */
export function useDiscardConfirm(dirty: boolean, onDiscard: () => void): () => void {
  const confirm = useOptionalConfirm();

  return useCallback(() => {
    if (!dirty) {
      onDiscard();
      return;
    }
    if (confirm) {
      void confirm({
        title: '放弃未保存的修改？',
        description: '关闭后，本次填写的内容不会保留。',
        confirmText: '放弃修改',
        cancelText: '继续编辑',
        danger: true,
      }).then((answer) => {
        // 取消返回 null；确认返回 ''（该动作不需要原因）
        if (answer !== null) onDiscard();
      });
      return;
    }
    // 没有 Provider 的环境（后台之外）用原生确认框兜底
    if (window.confirm('放弃未保存的修改？关闭后，本次填写的内容不会保留。')) {
      onDiscard();
    }
  }, [confirm, dirty, onDiscard]);
}
