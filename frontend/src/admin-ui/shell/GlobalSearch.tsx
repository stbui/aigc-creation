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
import { useAdmin } from '../../context/AdminContext';
import {
  ADMIN_COMMANDS,
  COMMAND_SECTION_LABELS,
  filterAdminCommands,
  matchAdminCommands,
  type AdminCommand,
} from '../../lib/admin-commands';
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
  const { canAny, me } = useAdmin();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AdminSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const normalizedQuery = query.trim();
  const flatHits = useMemo(() => flattenHits(result), [result]);
  const isCommandMode = normalizedQuery.startsWith('>');
  const commandQuery = isCommandMode ? normalizedQuery.slice(1).trim() : '';
  const commands = useMemo(
    () => filterAdminCommands(ADMIN_COMMANDS, canAny),
    [canAny],
  );
  const commandHits = useMemo(
    () => matchAdminCommands(commands, commandQuery),
    [commands, commandQuery],
  );
  const showCommands = isCommandMode || normalizedQuery.length === 0;

  const recentKey = me?.id ? `huojue.admin.recent.${me.id}` : null;
  const [recent, setRecent] = useState<AdminCommand[]>([]);

  useEffect(() => {
    if (!open || !recentKey) return;
    try {
      const raw = localStorage.getItem(recentKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (!Array.isArray(parsed)) return;
      const byKey = new Map(commands.map((command) => [command.key, command]));
      const next = parsed
        .filter((key): key is string => typeof key === 'string')
        .map((key) => byKey.get(key))
        .filter((command): command is AdminCommand => Boolean(command))
        .slice(0, 6);
      setRecent((prev) =>
        prev.length === next.length && prev.every((item, index) => item.key === next[index].key)
          ? prev
          : next,
      );
    } catch {
      setRecent([]);
    }
  }, [commands, open, recentKey]);

  const chooseCommand = (command: AdminCommand) => {
    if (recentKey) {
      try {
        const next = [command.key, ...recent.map((item) => item.key)].slice(0, 8);
        localStorage.setItem(recentKey, JSON.stringify([...new Set(next)]));
      } catch {
        /* 存不下不影响跳转 */
      }
    }
    choose(command.path);
  };

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

    if (isCommandMode) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

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
    const length = showCommands ? commandHits.length : flatHits.length;
    setActiveIndex(length > 0 ? 0 : -1);
  }, [commandHits.length, flatHits.length, showCommands]);

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
    const length = showCommands ? commandHits.length : flatHits.length;
    if (event.key === 'ArrowDown' && length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % length);
      return;
    }
    if (event.key === 'ArrowUp' && length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? length - 1 : current - 1));
      return;
    }
    if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      if (showCommands) {
        const command = commandHits[activeIndex];
        if (command) chooseCommand(command);
      } else {
        const hit = flatHits[activeIndex];
        if (hit) choose(hit.link);
      }
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
          <span className="min-w-0 flex-1 truncate">搜索用户、订单… 或输入 &gt; 使用命令</span>
          <kbd className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
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
            placeholder="输入邮箱、订单号… 或输入 > 使用命令"
            aria-label="搜索用户、订单、工单、任务或素材"
            className="h-10 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
          {loading && (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="搜索中" />
          )}
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[min(62vh,520px)] overflow-y-auto" data-testid="admin-global-search-results">
          {showCommands ? (
            <div className="py-2" data-testid="admin-command-results">
              {normalizedQuery.length === 0 && recent.length > 0 && (
                <section aria-labelledby="command-recent">
                  <div className="px-4 pb-1 pt-2 text-xs font-semibold tracking-wide text-muted-foreground">
                    <h2 id="command-recent">最近使用</h2>
                  </div>
                  {recent.map((command) => (
                    <button
                      key={`recent-${command.key}`}
                      type="button"
                      onClick={() => chooseCommand(command)}
                      className="mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                        ↺
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{command.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">打开</span>
                    </button>
                  ))}
                </section>
              )}
              {(['navigate', 'create', 'view'] as const).map((section) => {
                const sectionCommands = commandHits.filter((command) => command.section === section);
                if (sectionCommands.length === 0) return null;
                return (
                  <section key={section} aria-labelledby={`command-${section}`}>
                    <div className="flex items-center justify-between px-4 pb-1 pt-2 text-xs font-semibold tracking-wide text-muted-foreground">
                      <h2 id={`command-${section}`}>{COMMAND_SECTION_LABELS[section]}</h2>
                      <span>{sectionCommands.length} 项</span>
                    </div>
                    {sectionCommands.map((command) => {
                      const index = commandHits.findIndex((item) => item.key === command.key);
                      return (
                        <button
                          key={command.key}
                          type="button"
                          role="option"
                          aria-selected={activeIndex === index}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => chooseCommand(command)}
                          className={cn(
                            'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors',
                            activeIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                          )}
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                            {section === 'create' ? '+' : section === 'view' ? '◫' : '→'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">
                              {command.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {command.path}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">打开</span>
                        </button>
                      );
                    })}
                  </section>
                );
              })}
              {commandHits.length === 0 && (
                <SearchHint
                  title="没有匹配的命令"
                  description="试试「商品」「工单」「退款」或直接输入 > 浏览全部命令。"
                />
              )}
            </div>
          ) : normalizedQuery.length < MIN_QUERY_LENGTH ? (
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
                  <div className="flex items-center justify-between px-4 pb-1 pt-2 text-xs font-semibold tracking-wide text-muted-foreground">
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
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground">
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
                            <span className="shrink-0 text-xs text-muted-foreground">打开</span>
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

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭 · 输入 &gt; 使用命令</span>
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
