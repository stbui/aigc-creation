import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { Search } from 'lucide-react';
import { adminSearchApi } from '../../lib/api';
import type { AdminSearchGroup } from '../../types/api';
import { cx } from '../lib/cn';

/**
 * 后台全局搜索面板。
 *
 * 交互口径沿用旧版顶栏搜索，不因换壳降级：
 *   1. 少于 2 个字符不发请求（后端同样返回空组，两边一致才不会有闪烁）；
 *   2. 每类只显示前 5 条，翻页留给各列表页；
 *   3. 点击即跳转并清空关键词；
 *   4. ⌘K / Ctrl+K 在任何后台页面唤起，↑↓ 选择、Enter 打开、Esc 关闭。
 *
 * 搜索接口是 `GET /admin/search`，按权限点由后端裁剪结果 —— 前端不做
 * 二次过滤，否则「搜得到但点不开」的情况会被藏起来。
 */
export function AdminSearchPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (to: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<AdminSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  const q = keyword.trim();
  const hits = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => ({ groupKey: group.key, ...item }))),
    [groups],
  );
  const total = groups.reduce((sum, group) => sum + group.total, 0);

  // ⌘K 唤起；输入框随面板打开聚焦
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  // 关闭时清空，避免下次打开看到上次结果分不清是缓存还是新搜索
  useEffect(() => {
    if (open) return;
    setKeyword('');
    setGroups([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [groups]);

  useEffect(() => {
    if (!open || q.length < 2) {
      setGroups([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      adminSearchApi
        .search(q, controller.signal)
        .then((result) => {
          setGroups(result.groups);
          setError(null);
        })
        .catch((nextError: unknown) => {
          if (controller.signal.aborted) return;
          setError(nextError instanceof Error ? nextError.message : '搜索失败');
          setGroups([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, open, retryNonce]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const go = useCallback(
    (to: string) => {
      onNavigate(to);
      onOpenChange(false);
    },
    [onNavigate, onOpenChange],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) go(hit.link);
    }
  };

  const activeHit = hits[activeIndex];
  let hitCursor = 0;

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="bui-scope fixed inset-0 z-[1050] flex items-start justify-center bg-neutral-950/40 px-6 pt-[12vh]"
    >
      <Modal className="w-full max-w-[640px] outline-none">
        <Dialog aria-label="后台全局搜索" className="outline-none">
        <div
          className="overflow-hidden rounded-2xl border border-border-table bg-white shadow-2xl"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-border-table px-4 py-3">
            <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            <input
              ref={inputRef}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索用户 / 订单 / 工单 / 任务 / 素材"
              aria-label="后台全局搜索"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
            />
            <kbd className="rounded border border-border-table bg-background-secondary-default px-1.5 py-0.5 text-[10px] text-text-tertiary">
              Esc
            </kbd>
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-2">
            {error && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <span className="min-w-0 truncate">{error}</span>
                <button type="button" className="shrink-0 underline" onClick={() => setRetryNonce((n) => n + 1)}>
                  重试
                </button>
              </div>
            )}

            {!error && q.length < 2 && (
              <p className="px-3 py-8 text-center text-xs text-text-tertiary">
                输入至少 2 个字符开始搜索
              </p>
            )}

            {!error && q.length >= 2 && loading && hits.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-text-tertiary">搜索中…</p>
            )}

            {!error && q.length >= 2 && !loading && hits.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-text-tertiary">
                没有匹配「{q}」的结果
              </p>
            )}

            {groups.map((group) => {
              const groupHits = group.items;
              return (
                <div key={group.key} className="mb-1">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-text-tertiary">
                    <span>{group.label}</span>
                    <span>{group.total > groupHits.length ? `前 ${groupHits.length} / 共 ${group.total}` : group.total}</span>
                  </div>
                  {groupHits.map((item) => {
                    const index = hitCursor++;
                    const isActive = index === activeIndex;
                    return (
                      <button
                        key={`${group.key}-${item.id}`}
                        ref={isActive ? activeItemRef : undefined}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(item.link)}
                        className={cx(
                          'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left',
                          isActive ? 'bg-accent-100' : 'hover:bg-background-secondary-default',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text-primary">{item.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-text-tertiary">
                            {item.subtitle}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-border-table px-4 py-2 text-[11px] text-text-tertiary">
            <span>{q.length >= 2 ? `共 ${total} 条结果` : '支持用户、订单、工单、任务、素材'}</span>
            <span className="flex items-center gap-2">
              <span>↑↓ 选择</span>
              <span>Enter 打开</span>
              <span>Esc 关闭</span>
            </span>
          </div>
        </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
