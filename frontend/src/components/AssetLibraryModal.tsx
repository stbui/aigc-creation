import './AssetLibraryModal.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCapabilities } from '../hooks/useCapabilities';
import { StateButton, StateEmpty, StateError, StateLoading } from './StateViews';
import { AssetLibraryPickerCard } from './AssetLibraryPickerCard';
import { FilterRadioGroup } from './FilterRadioGroup';
import { Search } from './Search';
import {
  buildCapabilityNames,
  buildCapabilityOptions,
  capabilityLabelOf,
  DATE_LABELS,
  filterAssets,
  KIND_LABELS,
  PICKER_PAGE_SIZE,
  type DateFilter,
  type PickerKind,
} from './assetLibraryFilters';
import type { Asset } from '../types/api';
import {
  useApp,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Pagination,
  PaginationContent,
  PaginationItem,
} from '../ui';

/**
 * 素材库导入选择器
 *
 * ## 交互
 *
 * 多选 → 底部显示「已选 N / 最多选择 M 张」 → 「确定」一次性回填多张; 「取消」丢弃选择; 「清除选择」清空当前勾选超过上限时禁止继续勾选并如实提示 (不静默截断)
 *
 * ## 加载策略 (2026-11-14 性能修复)
 *
 * 列表按后端分页补齐，弹窗每页展示 24 条；**只有接近视口的卡片才请求缩略图**（`PickerCard` 里的
 * `useNearViewport`，预载距离 300px）。此前是把 120 个 `<img>` 一次性交给浏览器
 * 原生 `loading="lazy"` —— 它的预载距离宽达 1250–3000px，等于全部卡片立刻并发
 * 请求缩略图；后端每张要解码 1–2s 且占满主线程，于是「图一直加载不完」。
 * 后端已同步改为写入侧预热（见 `backend/src/assets/thumb-render.ts`）。
 */

export interface AssetLibraryModalProps {
  open: boolean;
  loading: boolean;
  items: Asset[];
  /** 加载失败信息; 非空则渲染失败态 (而非「暂无素材」空态) */
  error?: string | null;
  onCancel: () => void;
  /**
   * 点选回填回调。
   *
   * 返回 `false` = **拒绝**本次选择 (超额 / 重复) → 多选确定时中止整批,
   * 弹窗保持打开; 返回 `void` / `true` = 接受。
   *
   * ⚠️ 各调用点必须显式返回 false 而非 undefined —— undefined 会被当成接受,
   * 于是超额的素材静默进入, 上限形同虚设。
   */
  onPick: (asset: Asset) => void | boolean;
  /**
   * 最多可选张数 —— 参考站的 maxSelectable 语义。
   * 不传则不限（可勾选任意张）。传入时超出即禁止勾选并提示。
   */
  maxSelectable?: number;
}

const PAGINATION_BUTTON_CLASS =
  'inline-flex h-8 min-w-16 items-center justify-center gap-1 rounded-lg border border-[var(--border-soft)] bg-transparent px-[var(--space-10)] text-xs text-[var(--alp-text-7)] shadow-none transition-colors hover:border-[var(--border-brand)] hover:bg-transparent hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

export function AssetLibraryModal({
  open,
  loading,
  items,
  error = null,
  onCancel,
  onPick,
  maxSelectable,
}: AssetLibraryModalProps) {
  const { message } = useApp();
  const { data: capabilitiesData } = useCapabilities();
  /** 侧栏当前维度 */
  const [kind, setKind] = useState<PickerKind>('all');
  /** 侧栏当前用途 */
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all');
  /** 工具栏日期筛选 */
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  /** 工具栏搜索词 */
  const [keyword, setKeyword] = useState('');
  /** 已勾选的素材 id —— 参考站是多选语义 */
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);

  // 每次打开重置: 上一次的筛选与勾选不该带进新弹窗
  useEffect(() => {
    if (open) {
      setKind('all');
      setCapabilityFilter('all');
      setDateFilter('all');
      setKeyword('');
      setSelected([]);
      setPage(1);
    }
  }, [open]);

  /** capability id → 展示名。能力清单不可用时退回 id, 不隐藏真实分类。 */
  const capabilityNames = useMemo(() => buildCapabilityNames(capabilitiesData?.items), [capabilitiesData]);

  /**
   * 侧栏「用途分类」：只聚合当前素材中真实存在的用途（口径见 assetLibraryFilters）。
   */
  const capabilityOptions = useMemo(
    () => buildCapabilityOptions(items, capabilitiesData?.items, capabilityNames),
    [items, capabilitiesData, capabilityNames],
  );

  /** 用途展示名; 卡片与搜索共用, 保证文案一致。 */
  const capabilityLabel = useMemo(() => capabilityLabelOf(capabilityNames), [capabilityNames]);

  /** 前端按维度 / 用途 / 日期 / 关键词过滤（规则见 assetLibraryFilters.filterAssets）。 */
  const visible = useMemo(
    () => filterAssets(items, { kind, capabilityFilter, dateFilter, keyword }, capabilityLabel),
    [items, kind, capabilityFilter, dateFilter, keyword, capabilityLabel],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PICKER_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = visible.slice(
    (currentPage - 1) * PICKER_PAGE_SIZE,
    currentPage * PICKER_PAGE_SIZE,
  );

  // 筛选结果变少时把页码收回有效范围，避免停在空白页。
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const goToPage = (nextPage: number) => {
    const next = Math.min(Math.max(nextPage, 1), pageCount);
    setPage(next);
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  };

  /**
   * 是否已达选择上限。
   *
   * 达上限后未选中的卡片渲染为 `disabled` (CSS 里 `.alp-card:disabled` 早已写好,
   * 此前却没有代码设置该属性 —— 卡片看起来完全可点, 点下去只弹一句 warning)。
   * 只禁用**未选中**的卡片: 已选中的必须保持可点, 否则用户没法取消勾选来换一张。
   */
  const atLimit = maxSelectable !== undefined && selected.length >= maxSelectable;

  const toggle = (asset: Asset) => {
    setSelected((prev) => {
      if (prev.includes(asset.id)) {
        return prev.filter((id) => id !== asset.id);
      }
      if (maxSelectable !== undefined && prev.length >= maxSelectable) {
        // 参考站: 达到上限后不可再选。这里如实提示, 不静默截断。
        message.warning(`最多选择 ${maxSelectable} 张`);
        return prev;
      }
      return [...prev, asset.id];
    });
  };

  /**
   * 确定: 一次性回填所有勾选项。
   *
   * ## 与各页 onPick 契约的兼容
   *
   * 各页的 onPick 返回 `false` 表示**拒绝**本次选择 (超额/重复), `void|true` 表示接受。
   * 多选下这个契约要这样落地:
   *   - 逐个调用, 任一页返回 false 即**中止整批**并保持弹窗打开 ——
   *     否则会出现"3 张里进了 2 张"的半吊子状态, 用户不知道自己选的去哪了。
   *   - 已接受的那些**不回滚** (React 状态已更新), 但弹窗不关, 底部计数
   *     仍在, 用户可改选后重新确定。弹窗开着本身就是"还没完成"的信号。
   *
   * ⚠️ 参考站是"选 N 张 → 确定 → 一次回填", 本实现把多选拆成逐个 onPick 是
   * 为了不改各页既有回填逻辑 (它们各自的额度/去重规则不同) —— 行为等价,
   * 但**拒绝时的处理比参考站更保守**(参考站不校验上限, 超出也照收)。
   */
  const confirm = () => {
    if (selected.length === 0) {
      onCancel();
      return;
    }
    const chosen = items.filter((a) => selected.includes(a.id));
    for (const a of chosen) {
      if (onPick(a) === false) return; // 中止, 弹窗保持打开
    }
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="alp-modal gap-0 p-0 sm:max-w-[min(1180px,calc(100vw-40px))]"
        showCloseButton={false}
      >
        <DialogHeader className="alp-header flex-row gap-[var(--space-16)] text-left">
          <div className="alp-header-main">
            <DialogTitle className="alp-title">从素材库导入</DialogTitle>
            <DialogDescription className="sr-only">
              选择素材并导入到当前编辑区域。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" className="alp-close" aria-label="关闭素材库">
              <X size={19} className="size-[19px]" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="alp-body">
          {/* ── 工具栏: 来源胶囊 + 日期筛选 + 搜索 ── */}
          <div className="alp-toolbar">
            <div className="alp-groups" role="group" aria-label="素材来源">
              {KIND_LABELS.map((k) => (
                <Button
                  key={k.id}
                  variant="ghost"
                  aria-pressed={kind === k.id}
                  className={`alp-chip${kind === k.id ? ' is-active' : ''}`}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </Button>
              ))}
            </div>

            <div className="alp-toolbar-right">
              <FilterRadioGroup
                options={DATE_LABELS}
                value={dateFilter}
                onChange={setDateFilter}
                ariaLabel="日期筛选"
                idPrefix="asset-library-date"
              />

              <Search
                inputClassName="alp-search"
                value={keyword}
                placeholder="搜索素材名称 / 地址"
                ariaLabel="搜索素材名称 / 地址"
                onChange={setKeyword}
              />
            </div>
          </div>

          {/* ── 主体: 来源/用途侧栏 + 内容区 ── */}
          <div className="alp-layout">
            <aside className="alp-sidebar">
              <strong>素材来源</strong>
              <nav aria-label="素材来源">
                {KIND_LABELS.map((k) => (
                  <Button
                    key={k.id}
                    variant="ghost"
                    className={kind === k.id ? 'is-active' : ''}
                    aria-current={kind === k.id}
                    onClick={() => setKind(k.id)}
                  >
                    {k.label}
                  </Button>
                ))}
              </nav>

              {capabilityOptions.length > 0 && (
                <section className="alp-sidebar-section">
                  <strong>用途分类</strong>
                  <nav aria-label="用途分类">
                    <Button
                      variant="ghost"
                      className={capabilityFilter === 'all' ? 'is-active' : ''}
                      aria-current={capabilityFilter === 'all'}
                      onClick={() => setCapabilityFilter('all')}
                    >
                      <span>全部用途</span>
                      <em className="alp-sidebar-count">{items.length}</em>
                    </Button>
                    {capabilityOptions.map((option) => (
                      <Button
                        key={option.id}
                        variant="ghost"
                        className={capabilityFilter === option.id ? 'is-active' : ''}
                        aria-current={capabilityFilter === option.id}
                        title={`${option.label}（${option.count}）`}
                        onClick={() => setCapabilityFilter(option.id)}
                      >
                        <span>{option.label}</span>
                        <em className="alp-sidebar-count">{option.count}</em>
                      </Button>
                    ))}
                  </nav>
                </section>
              )}
            </aside>

            <div className="alp-main">
              <div className="alp-content" ref={contentRef}>
                {loading ? (
                  <div className="alp-state">
                    <StateLoading tip="正在加载素材库…" />
                  </div>
                ) : error ? (
                  /* 「没连上」不是「没素材」 */
                  <div className="alp-state">
                    <StateError
                      compact
                      title="素材库加载失败"
                      desc="素材库加载失败，请稍后重试。"
                    />
                  </div>
                ) : visible.length === 0 ? (
                  /*
                   * ⚠️ 「筛完没剩」≠「库里没有」。两者原先共用一句「素材库暂无图片 /
                   * 请先上传图片」—— 素材有 70 张、只是搜索词或日期档位筛空了时,
                   * 这句话是**谎报**: 用户以为素材没了, 会去重复上传。
                   * (StateViews.tsx 的空态注释本来就要求把这两种分开。)
                   */
                  <div className="alp-state">
                    {items.length === 0 ? (
                      <StateEmpty compact title="素材库暂无图片" desc="请先上传图片，再从这里导入。" />
                    ) : (
                      <StateEmpty
                        compact
                        title="没有符合条件的素材"
                        desc="试试换个关键词，或把日期与维度放宽。"
                        action={
                          <StateButton
                            onClick={() => {
                              setKind('all');
                              setCapabilityFilter('all');
                              setDateFilter('all');
                              setKeyword('');
                            }}
                          >
                            清除筛选
                          </StateButton>
                        }
                      />
                    )}
                  </div>
                ) : (
                  <div className="alp-grid">
                    {pageItems.map((a, index) => (
                      <AssetLibraryPickerCard
                        key={a.id}
                        asset={a}
                        selected={selected.includes(a.id)}
                        priority={index < 8}
                        atLimit={atLimit}
                        maxSelectable={maxSelectable}
                        capabilityLabel={capabilityLabel}
                        onToggle={toggle}
                      />
                    ))}
                  </div>
                )}
                {visible.length > PICKER_PAGE_SIZE && (
                  <Pagination
                    className="mt-[var(--space-20)] w-full text-xs text-[var(--alp-text-9)]"
                    aria-label="素材库分页"
                  >
                    <PaginationContent className="gap-[var(--space-12)]">
                      <PaginationItem>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="上一页"
                          disabled={currentPage <= 1}
                          className={PAGINATION_BUTTON_CLASS}
                          onClick={() => goToPage(currentPage - 1)}
                        >
                          <ChevronLeft className="size-4" aria-hidden="true" />
                          <span>上一页</span>
                        </Button>
                      </PaginationItem>
                      <PaginationItem>
                        <span aria-live="polite">
                          第 {currentPage} / {pageCount} 页 · 共 {visible.length} 个
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="下一页"
                          disabled={currentPage >= pageCount}
                          className={PAGINATION_BUTTON_CLASS}
                          onClick={() => goToPage(currentPage + 1)}
                        >
                          <span>下一页</span>
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Button>
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            </div>
          </div>

          {/*
            ── 底部: 已选计数 + 清除选择 + 取消/确定 ──
            参考站 .asset-library-picker-footer 是 dialog 的**直接子元素**(与 layout 平级),
            横跨整个弹窗宽度, 而不是缩在内容列里 —— 放进 .alp-main 会让「已选 N」从
            侧栏右边 26px 处才开始, 与参考站差 184px。
          */}
          <div className="alp-footer">
            <div className="alp-footer-info">
              <span>
                已选 {selected.length}
                {maxSelectable !== undefined ? ` / 最多选择 ${maxSelectable} 张` : ' 张'}
              </span>
              {selected.length > 0 && (
                <Button variant="ghost" className="alp-clear" onClick={() => setSelected([])}>
                  清除选择
                </Button>
              )}
            </div>
            <div className="alp-footer-actions">
              <Button variant="ghost" className="alp-btn alp-btn-cancel" onClick={onCancel}>
                取消
              </Button>
              <Button
                variant="ghost"
                className="alp-btn alp-btn-confirm"
                disabled={selected.length === 0}
                onClick={confirm}
              >
                {/* 单选入口（如 SKU 模板图）明确写「使用此素材」，避免用户
                    在已选 1 张后仍找不到完成导入的按钮。 */}
                {maxSelectable === 1 ? '使用此素材' : '可多选 · 选择'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
