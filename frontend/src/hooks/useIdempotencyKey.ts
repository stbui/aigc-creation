import { useCallback, useRef } from 'react';
import { newIdempotencyKey } from '../lib/api';

const EMPTY = { fingerprint: null as string | null, key: '' };

/**
 * 单次提交的幂等键。
 *
 * 请求超时 / 连接重置但服务端已落单时，用户重试必须复用同一个 key，
 * 否则同一个输入会建两次任务、扣两次费。输入指纹变化即视为新一次提交。
 *
 * 拿到 taskId 后调用 `reset()`；用户主动再生成时才会换新 key。
 */
export function useIdempotencyKey() {
  const pendingRef = useRef<{ fingerprint: string | null; key: string }>(EMPTY);

  const keyFor = useCallback((fingerprint: string) => {
    const key =
      pendingRef.current.fingerprint === fingerprint
        ? pendingRef.current.key
        : newIdempotencyKey();
    pendingRef.current = { fingerprint, key };
    return key;
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = EMPTY;
  }, []);

  return { keyFor, reset };
}
