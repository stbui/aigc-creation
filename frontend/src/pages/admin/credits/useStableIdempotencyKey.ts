import { useRef } from 'react';
import { newIdempotencyKey } from './api';

interface KeyState {
  active: boolean;
  fingerprint: string;
  key: string;
}

/**
 * 为一次「打开期间、内容不变」的提交生成稳定幂等键。
 *
 * 关闭后重新打开、或失败后修改请求内容，都必须换新键：旧键只对应旧请求，
 * 复用它会让新请求命中旧流水，看起来成功但实际没有执行。
 */
export function useStableIdempotencyKey(active: boolean, fingerprint: string): string {
  const state = useRef<KeyState>({ active: false, fingerprint: '', key: '' });

  if (!active) {
    state.current = { active: false, fingerprint: '', key: '' };
  } else if (!state.current.active || state.current.fingerprint !== fingerprint) {
    state.current = { active: true, fingerprint, key: newIdempotencyKey() };
  }

  return state.current.key;
}
