import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { AlertCircle, LoaderCircle, Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '~/admin-ui/components/ui/dialog';
import { Input } from '~/admin-ui/components/ui/input';
import { cn } from '~/admin-ui/lib/cn';
import { adminSearchApi } from '../../lib/api';
import type { AdminSearchResult } from '../../types/api';

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 220;

const modifierKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

function flattenHits(result: AdminSearchResult | null) {
  return result?.groups.flatMap((group) => group.items) ?? [];
}

/**
 * 后台顶栏全局搜索。
 *
 * 搜索接口只回每类前 5 条，前端不把它扩展成第二套列表页：点击结果直接
 * 落到对应详情或筛选后的列表。⌘/Ctrl + K 打开，↑/↓ 选择，Enter 跳转。
 *
 * 跳转统一交给外壳的 `onNavigate`，因此未保存表单的离开确认不会被绕开。
 */
export function GlobalSearch({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AdminSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const normalizedQuery = query.trim();
  const flatHits = useMemo(() => flattenHits(result), [result]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      adminSearchApi
        .search(normalizedQuery, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setResult(next);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setResult(null);
          setError(cause instanceof Error ? cause.message : '搜索失败，请稍后重试');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, open]);

  useEffect(() => {
    setActiveIndex(flatHits.length > 0 ? 0 : -1);
  }, [flatHits]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setResult(null);
      setError(null);
      setLoading(false);
      setActiveIndex(-1);
    }
  };

  const choose = (link: string) => {
    setOpen(false);
    onNavigate(link);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && flatHits.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flatHits.length);
      return;
    }
    if (event.key === 'ArrowUp' && flatHits.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? flatHits.length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(flatHits[activeIndex].link);
    }
  };

  let hitIndex = -1;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid="admin-global-search-trigger"
          aria-label={`全局搜索（${modifierKey}+K）`}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-9 w-full max-w-[380px] items-center gap-2 rounded-md border border-border bg-muted/45 px-3 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">搜索用户、订单、工单、任务或素材</span>
          <kbd className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
            {modifierKey} K
          </kbd>
        </button>
      </DialogTrigger>

      <DialogContent className="top-[18vh] max-w-[720px] translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">全局搜索</DialogTitle>
        <DialogDescription className="sr-only">
          搜索用户、订单、工单、任务和素材，使用上下方向键选择，回车跳转。
        </DialogDescription>

        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="输入邮箱、订单号、工单号、任务 ID 或素材 ID…"
            aria-label="搜索用户、订单、工单、任务或素材"
            className="h-10 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
          {loading && (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="搜索中" />
          )}
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[min(62vh,520px)] overflow-y-auto" data-testid="admin-global-search-results">
          {normalizedQuery.length < MIN_QUERY_LENGTH ? (
            <SearchHint
              title="输入至少 2 个字符开始搜索"
              description="支持邮箱、用户名、订单号、工单号、任务 ID、素材 ID 与文件名。"
            />
          ) : error ? (
            <SearchHint title="搜索失败" description={error} danger />
          ) : loading && !result ? (
            <SearchHint title="正在搜索…" description="正在按当前角色权限检索可访问的数据。" />
          ) : result && result.total === 0 ? (
            <SearchHint
              title="没有找到匹配结果"
              description={`没有可访问的用户、订单、工单、任务或素材匹配「${normalizedQuery}」。`}
            />
          ) : result ? (
            <div className="py-2">
              {result.groups.map((group) => (
                <section key={group.key} aria-labelledby={`search-group-${group.key}`}>
                  <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    <h2 id={`search-group-${group.key}`}>{group.label}</h2>
                    <span>{group.total} 条</span>
                  </div>
                  {group.items.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-muted-foreground">该分类无结果</p>
                  ) : (
                    <div role="listbox" aria-label={`${group.label}搜索结果`}>
                      {group.items.map((item) => {
                        hitIndex += 1;
                        const index = hitIndex;
                        return (
                          <button
                            key={`${group.key}-${item.id}`}
                            type="button"
                            role="option"
                            aria-selected={activeIndex === index}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => choose(item.link)}
                            className={cn(
                              'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors',
                              activeIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                            )}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
                              {group.label.slice(0, 1)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {item.title}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {item.subtitle}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">打开</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <SearchHint
              title="输入至少 2 个字符开始搜索"
              description="搜索结果会按当前后台账号的权限过滤。"
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>只显示你有权限查看的数据</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchHint({
  title,
  description,
  danger = false,
}: {
  title: string;
  description: string;
  danger?: boolean;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-8 text-center">
      <span
        className={cn(
          'mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground',
          danger && 'bg-danger-soft text-danger-text',
        )}
      >
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-[460px] text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
