import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Modal } from 'antd';
import { ChevronDown, Search, X } from 'lucide-react';
import { assetsApi, toAbsoluteUrl } from '../lib/api';
import { StateEmpty, StateError, StateLoading } from './StateViews';
import { ResultMedia, modalityOfFormat } from './ResultMedia';
import type { Asset } from '../types/api';

/**
 * 素材库导入选择器 —— 1:1 复刻参考站 (ijihua.cn/free-creation) 的
 * 「从素材库导入」大弹窗 (参考站内部组件名 asset-library-picker)。
 *
 * ## 复刻依据 (2026-10-20 取证)
 *
 * 参考站该入口**未登录时是 disabled**, 且其账号体系与本仓独立 → 无法直接实拍。
 * 故改从两条**可验证的**来源取证:
 *   1. 参考站线上样式表 `index-glaqVozH.css` 的 `.asset-library-picker-*` 规则
 *      (尺寸/圆角/间距/字号全部有实值, 逐条抄录)
 *   2. 参考站前端 bundle 的反混淆结果 (类名/文案/交互语义)
 *
 * ## 参考站形态 (CSS 实测)
 *
 *   backdrop   inset 0, blur(3px), 背景 #1c1e2d75, grid 居中
 *   dialog     min(1180px, 100vw - 40px), 圆角 20, 白底, 阴影 0 24px 80px #282b4c33
 *              max-height min(760px, 100vh - 40px), 纵向 flex
 *   header     padding 22px 26px 18px, 下边框 #eef0f5
 *              eyebrow 12px/18 #8d95a8; h2 22px/30 #171a2b
 *              close 34x34 圆形, 底 #f3f4f7, 悬浮 #e9eaf0
 *   toolbar    底 #fbfcfe, padding 14px 26px, gap 16
 *              groups 横向滚动胶囊 (h34, 圆角 9, 边框 #e4e7ef, 选中 #f1efff/#5546d8)
 *              search  250x34, 圆角 9, 边框 #e2e5ed
 *   layout     flex: 1
 *   sidebar    宽 184, 底 #f7f8fd, 右边框 #eef0f5, padding 18px 12px 20px
 *              nav button 13px, 圆角 10, 选中 白底+紫字+阴影
 *   content    padding 20px 26px 24px, 最小高 280, 纵向滚动
 *   grid       repeat(auto-fill, minmax(128px, 1fr)), gap 14
 *   card       圆角 12, 边框 #e3e6ee, 悬浮上浮 2px + 阴影
 *              选中 2px #5546d8 + 外发光; 右上角勾选圆标 24x24
 *   footer     padding 14px 26px 18px, 上边框 #eef0f5, 12px #8d95a8
 *              cancel 描边 / confirm 品牌紫实心, 36 高, 圆角 9
 *
 * ## 与参考站的**刻意**差异
 *
 * 参考站侧栏的「素材分组」是**用户自建分组** (需 asset_group 表), 本项目素材库
 * 没有这个数据模型 —— 故侧栏用**本项目真实存在的维度**: 全部 / 原始图片 / 生成图片。
 * 不臆造分组表, 也不在界面上放点不动的假入口。
 *
 * ## 交互
 *
 *   多选 (参考站 maxSelectable 语义) → 底部显示「已选 N / 最多选择 M 张」
 *   → 「确定」一次性回填多张; 「取消」丢弃选择; 「清除选择」清空当前勾选
 *   超过上限时禁止继续勾选并如实提示 (不静默截断)
 */

export interface UseAssetLibraryResult {
  open: boolean;
  loading: boolean;
  items: Asset[];
  /** 加载失败时的错误信息; 非空表示弹窗内应渲染失败态而非空态 */
  error: string | null;
  /** 打开弹窗并拉取素材（每次打开都重新拉，保证看到最新上传） */
  openLibrary: () => void;
  closeLibrary: () => void;
  /** 供弹窗点击某项时调用 */
  pick: (asset: Asset) => void;
}

/**
 * @param onPick 点选某素材后的回填逻辑，由各页自行实现（额度校验 / 去重 / 双通道选择等）。
 *   返回 `false` 表示拒绝本次选择（如超出张数上限），弹窗**保持打开**让用户改选；
 *   返回 `void` / `true` 视为接受，弹窗关闭。
 */
export function useAssetLibrary(onPick: (asset: Asset) => void | boolean): UseAssetLibraryResult {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Asset[]>([]);
  /**
   * 加载失败必须与「无素材」分开 (2026-10-20 修)。
   * 此前失败只 message.error 弹一下, 弹窗内照常渲染「素材库暂无原始图片」——
   * 用户以为是自己没上传过, 真相是接口没连上。
   */
  const [error, setError] = useState<string | null>(null);
  const { message } = App.useApp();

  const openLibrary = useCallback(() => {
    setOpen(true);
    setLoading(true);
    setError(null);
    // ⚠️ **不按 kind 过滤**: 选择器有「原始图片 / 生成图片」两个维度,
    // 若只拉 original, 切到「生成图片」永远是空的 —— 一个点不动的假入口。
    // 故一次性拉全部 (原始 + 生成), 由侧栏维度在前端分流。
    assetsApi
      .list({ limit: 120 })
      .then((res) => setItems(res.items ?? []))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '素材库加载失败');
        message.error('素材库加载失败');
      })
      .finally(() => setLoading(false));
  }, [message]);

  const closeLibrary = useCallback(() => setOpen(false), []);

  const pick = useCallback(
    (asset: Asset) => {
      if (onPick(asset) === false) return;
      setOpen(false);
    },
    [onPick],
  );

  // 弹窗关闭时释放列表，避免下次打开前渲染出上一次的旧数据
  useEffect(() => {
    if (!open) {
      setItems([]);
      setError(null);
    }
  }, [open]);

  return { open, loading, items, error, openLibrary, closeLibrary, pick };
}

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
  /** 只读模式：点击不触发回填（ToolShell 的导入按钮为诚实禁用态，用它做只读展示） */
  readOnly?: boolean;
  /**
   * 最多可选张数 —— 参考站的 maxSelectable 语义。
   * 不传则不限（可勾选任意张）。传入时超出即禁止勾选并提示。
   */
  maxSelectable?: number;
}

/** 侧栏维度 —— 本项目素材库真实存在的分类 */
type PickerKind = 'all' | 'original' | 'generated';

const KIND_LABELS: Array<{ id: PickerKind; label: string }> = [
  { id: 'all', label: '全部图片' },
  { id: 'original', label: '原始图片' },
  { id: 'generated', label: '生成图片' },
];

/** 日期筛选档位 —— 参考站工具栏的「全部 / 今天 / 昨天 / 近 7 天」 */
type DateFilter = 'all' | 'today' | 'yesterday' | 'week';

const DATE_LABELS: Array<{ id: DateFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'week', label: '近 7 天' },
];

export function AssetLibraryModal({
  open,
  loading,
  items,
  error = null,
  onCancel,
  onPick,
  readOnly = false,
  maxSelectable,
}: AssetLibraryModalProps) {
  const { message } = App.useApp();
  /** 侧栏当前维度 */
  const [kind, setKind] = useState<PickerKind>('all');
  /** 工具栏日期筛选 */
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  /** 工具栏搜索词 */
  const [keyword, setKeyword] = useState('');
  /** 已勾选的素材 id —— 参考站是多选语义 */
  const [selected, setSelected] = useState<string[]>([]);

  // 每次打开重置: 上一次的筛选与勾选不该带进新弹窗
  useEffect(() => {
    if (open) {
      setKind('all');
      setDateFilter('all');
      setKeyword('');
      setSelected([]);
    }
  }, [open]);

  /**
   * 前端按维度过滤。
   *
   * ⚠️ 参考站是服务端筛选 (请求带 groupId / date), 本项目后端已支持
   * kind / from / to / keyword, 但**列表是随弹窗打开一次性拉取的**,
   * 故这里在前端过滤 —— 60 条量级下开销可忽略, 且省掉每次筛选都打一次接口。
   */
  const visible = useMemo(() => {
    let list = items;
    if (kind !== 'all') list = list.filter((a) => a.kind === kind);
    if (dateFilter !== 'all') {
      const from = startOfDay(dateFilter);
      const to = endOfDay(dateFilter);
      list = list.filter((a) => {
        const t = new Date(a.createdAt ?? 0).getTime();
        return t >= from && t <= to;
      });
    }
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((a) => a.sourceUrl.toLowerCase().includes(kw));
    }
    return list;
  }, [items, kind, dateFilter, keyword]);

  const toggle = (asset: Asset) => {
    if (readOnly) return;
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
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width="min(1180px, calc(100vw - 40px))"
      centered
      className="alp-modal"
      closeIcon={null}
      styles={{ body: { padding: 0 } }}
      title={
        <div className="alp-header">
          <div className="alp-header-main">
            <span className="alp-eyebrow">我的素材库</span>
            <h2 className="alp-title">从素材库导入</h2>
          </div>
          <button type="button" className="alp-close" aria-label="关闭素材库" onClick={onCancel}>
            <X size={19} />
          </button>
        </div>
      }
    >
      <div className="alp-body">
        {/* ── 工具栏: 维度胶囊 + 日期筛选 + 搜索 ── */}
        <div className="alp-toolbar">
          <div className="alp-groups" role="tablist" aria-label="素材维度">
            {KIND_LABELS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                className={`alp-chip${kind === k.id ? ' is-active' : ''}`}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="alp-toolbar-right">
            <div className="alp-date-filter" role="group" aria-label="日期筛选">
              <button
                type="button"
                className="alp-date-trigger"
                aria-expanded={false}
                onClick={() => setDateFilter((v) => (v === 'all' ? 'today' : 'all'))}
              >
                <span>{DATE_LABELS.find((d) => d.id === dateFilter)?.label ?? '全部'}</span>
                <ChevronDown size={13} />
              </button>
              <div className="alp-date-menu" role="menu">
                {DATE_LABELS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="menuitem"
                    className={`alp-date-item${dateFilter === d.id ? ' is-active' : ''}`}
                    onClick={() => setDateFilter(d.id)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="alp-search">
              <Search size={14} />
              <input
                value={keyword}
                placeholder="搜索素材名称"
                onChange={(e) => setKeyword(e.target.value)}
              />
              {keyword && (
                <button type="button" className="alp-search-clear" aria-label="清除搜索" onClick={() => setKeyword('')}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── 主体: 侧栏 + 内容区 ── */}
        <div className="alp-layout">
          <aside className="alp-sidebar">
            <strong>素材维度</strong>
            <nav>
              {KIND_LABELS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={kind === k.id ? 'is-active' : ''}
                  aria-current={kind === k.id}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="alp-main">
            <div className="alp-content">
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
                    detail={error}
                  />
                </div>
              ) : visible.length === 0 ? (
                <div className="alp-state">
                  <StateEmpty compact title="素材库暂无图片" desc="请先上传图片，再从这里导入。" />
                </div>
              ) : (
                <div className="alp-grid">
                  {visible.map((a) => {
                    const on = selected.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`alp-card${on ? ' is-selected' : ''}`}
                        aria-pressed={on}
                        disabled={readOnly}
                        onClick={() => toggle(a)}
                      >
                        <div className="alp-cover">
                          {/* 视频素材用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白缩略图 */}
                          <ResultMedia
                            url={a.sourceUrl}
                            modality={modalityOfFormat(a.format)}
                            alt={a.sourceUrl}
                          />
                          {on && (
                            <span className="alp-check" aria-label="已选择">
                              ✓
                            </span>
                          )}
                        </div>
                        <span className="alp-name">
                          {a.width && a.height ? `${a.width}×${a.height}` : a.format}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 底部: 已选计数 + 清除选择 + 取消/确定 ── */}
            <div className="alp-footer">
              <div className="alp-footer-info">
                <span>
                  已选 {selected.length}
                  {maxSelectable !== undefined ? ` / 最多选择 ${maxSelectable} 张` : ' 张'}
                </span>
                {selected.length > 0 && (
                  <button type="button" className="alp-clear" onClick={() => setSelected([])}>
                    清除选择
                  </button>
                )}
              </div>
              <div className="alp-footer-actions">
                <button type="button" className="alp-btn alp-btn-cancel" onClick={onCancel}>
                  取消
                </button>
                <button
                  type="button"
                  className="alp-btn alp-btn-confirm"
                  disabled={readOnly || selected.length === 0}
                  onClick={confirm}
                >
                  可多选 · 选择
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 日期档位 → 起始时刻 */
function startOfDay(filter: Exclude<DateFilter, 'all'>): number {
  const d = new Date();
  if (filter === 'yesterday') d.setDate(d.getDate() - 1);
  if (filter === 'week') d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 日期档位 → 结束时刻 */
function endOfDay(filter: Exclude<DateFilter, 'all'>): number {
  const d = new Date();
  if (filter === 'yesterday') d.setDate(d.getDate() - 1);
  if (filter === 'week') d.setDate(d.getDate() - 6);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
