import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { assetSrc, assetThumbSrc, assetsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCapabilities } from '../hooks/useCapabilities';
import { StateButton, StateEmpty, StateError, StateLoading } from './StateViews';
import { ResultMedia, modalityOfFormat } from './ResultMedia';
import type { Asset } from '../types/api';
import { useApp, Button, Input, Modal } from '../ui';

/**
 * 素材库导入选择器
 *
 * ## 参考站形态 (CSS 实测)
 *
 *   backdrop   inset 0, blur(3px), 背景 #1c1e2d75, grid 居中
 *   dialog     min(1180px, 100vw - 40px), 圆角 20, 白底, 阴影 0 24px 80px #282b4c33
 *              max-height min(760px, 100vh - 40px), 纵向 flex
 *   header     padding 22px 26px 18px, 下边框 #eef0f5
 *              h2 22px/30 #171a2b
 *              close 34x34 圆形, 底 #f3f4f7, 悬浮 #e9eaf0
 *   toolbar    底 #fbfcfe, padding 14px 26px, gap 16
 *              groups 横向滚动胶囊 (h34, 圆角 9, 边框 #e4e7ef, 选中 #f1efff/#5546d8)
 *              search  250x34, 圆角 9, 边框 #e2e5ed
 *   layout     flex: 1
 *   sidebar    宽 184, 底 #f7f8fd, 右边框 #eef0f5, padding 18px 12px 20px
 *              nav button 13px, 圆角 10, 选中 白底+紫字+阴影
 *   content    padding 20px 26px 24px, 最小高 280, 纵向滚动
 *   grid       repeat(auto-fill, minmax(128px, 1fr)), gap 14
 *   card       纯图片瓦片, 圆角 12, 边框 #e3e6ee, 悬浮上浮 2px + 阴影
 *              选中 2px #5546d8 + 外发光; 右上角勾选圆标 24x24
 *   footer     padding 14px 26px 18px, 上边框 #eef0f5, 12px #8d95a8
 *              cancel 描边 / confirm 品牌紫实心, 36 高, 圆角 9
 *
 * ## 与参考站的**刻意**差异
 *
 * 参考站侧栏的「素材分组」是**用户自建分组** (需 asset_group 表), 本项目素材库
 * 没有这个数据模型。侧栏改为两个真实维度: 来源 (全部 / 原始图片 / 生成图片)
 * 与用途 (由素材的 capability 字段动态聚合)。不臆造分组表, 也不放点不动的假入口。
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
  const { message } = useApp();
  const { token, openLogin } = useAuth();

  const openLibrary = useCallback(() => {
    // 素材库是账号数据。未登录直接打开选择器只会拿到 401，并在弹窗里
    // 显示「素材库加载失败」—— 把「需要登录」误报成「服务坏了」。
    // 与提交/上传入口一致，先唤起登录弹窗，登录后用户再点一次即可。
    if (!token) {
      openLogin();
      return;
    }
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
  }, [message, openLogin, token]);

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
  /**
   * 最多可选张数 —— 参考站的 maxSelectable 语义。
   * 不传则不限（可勾选任意张）。传入时超出即禁止勾选并提示。
   */
  maxSelectable?: number;
}

/** 侧栏维度 —— 本项目素材库真实存在的分类 */
type PickerKind = 'all' | 'original' | 'generated';

/** 用途筛选中代表「没有关联能力」的哨兵值 */
const NO_CAPABILITY = '__none';

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

  // 每次打开重置: 上一次的筛选与勾选不该带进新弹窗
  useEffect(() => {
    if (open) {
      setKind('all');
      setCapabilityFilter('all');
      setDateFilter('all');
      setKeyword('');
      setSelected([]);
    }
  }, [open]);

  /** capability id → 展示名。能力清单不可用时退回 id, 不隐藏真实分类。 */
  const capabilityNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const capability of capabilitiesData?.items ?? []) {
      names.set(capability.id, capability.name);
    }
    return names;
  }, [capabilitiesData]);

  /**
   * 只聚合当前素材中真实存在的用途, 避免侧栏出现永远筛不出内容的空分类。
   * 顺序优先跟随后端能力清单; 清单里没有的历史 id 按名称排在后面。
   */
  const capabilityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const item of items) {
      if (!item.capability) {
        uncategorized += 1;
        continue;
      }
      counts.set(item.capability, (counts.get(item.capability) ?? 0) + 1);
    }

    const order = new Map(
      (capabilitiesData?.items ?? []).map((capability, index) => [capability.id, index]),
    );
    const options = [...counts.entries()].map(([id, count]) => ({
      id,
      label: capabilityNames.get(id) ?? id,
      count,
      order: order.get(id) ?? Number.MAX_SAFE_INTEGER,
    }));
    options.sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'),
    );
    if (uncategorized > 0) {
      options.push({
        id: NO_CAPABILITY,
        label: '未关联用途',
        count: uncategorized,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    return options;
  }, [items, capabilitiesData, capabilityNames]);

  /** 用途展示名; 卡片与搜索共用, 保证文案一致。 */
  const capabilityLabel = useCallback(
    (id: string | null | undefined) => (id ? capabilityNames.get(id) ?? id : '未关联用途'),
    [capabilityNames],
  );

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
    if (capabilityFilter === NO_CAPABILITY) {
      list = list.filter((a) => !a.capability);
    } else if (capabilityFilter !== 'all') {
      list = list.filter((a) => a.capability === capabilityFilter);
    }
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
      // placeholder 写的是“素材名称”，但 Asset 没有独立名称字段；
      // 用文件名/来源标题/能力名/来源站点一起匹配，避免用户按名字搜不到。
      list = list.filter((a) =>
        [
          a.sourceUrl,
          a.sourceTitle ?? '',
          a.sourceSite ?? '',
          a.capability ?? '',
          capabilityLabel(a.capability),
        ]
          .join(' ')
          .toLowerCase()
          .includes(kw),
      );
    }
    return list;
  }, [items, kind, capabilityFilter, dateFilter, keyword, capabilityLabel]);

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
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width="min(1180px, calc(100vw - 40px))"
      centered
      className="alp-modal"
      closeIcon={null}
      styles={{
        body: { padding: 0 },
        // 参考站 backdrop: 背景 #1c1e2d75 + blur(3px)。antd 默认遮罩是 45% 纯黑,
        // 既更深又没有毛玻璃 —— 一眼能看出是两个站点的弹层。
        mask: { background: '#1c1e2d75', backdropFilter: 'blur(3px)' },
      }}
      /*
       * ⚠️ `className` 是给**容器几何**用的, 不是给内容用的:
       * 兼容壳把它与 `ui-modal-surface` / `ant-modal-container` 挂在同一个 div 上,
       * global.css 里的容器规则因此必须写紧邻合并选择器 `.alp-modal.ant-modal-container`。
       * 改成后代形式 (` .alp-modal .ant-modal-container`) 会静默失效 ——
       * 表现为整个弹窗退回默认几何、底部操作条被撑到屏外。@2026-11-03
       */
      title={
        <div className="alp-header">
          <div className="alp-header-main">
            <h2 className="alp-title">从素材库导入</h2>
          </div>
          <Button type="text" className="alp-close" aria-label="关闭素材库" onClick={onCancel}>
            <X size={19} className="size-[19px]" />
          </Button>
        </div>
      }
    >
      <div className="alp-body">
        {/* ── 工具栏: 来源胶囊 + 日期筛选 + 搜索 ── */}
        <div className="alp-toolbar">
          <div className="alp-groups" role="tablist" aria-label="素材来源">
            {KIND_LABELS.map((k) => (
              <Button
                key={k.id}
                type="text"
                role="tab"
                aria-selected={kind === k.id}
                className={`alp-chip${kind === k.id ? ' is-active' : ''}`}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </Button>
            ))}
          </div>

          <div className="alp-toolbar-right">
            <div className="alp-date-flat" role="group" aria-label="日期筛选">
              <span className="alp-filter-label">日期</span>
              {DATE_LABELS.map((d) => (
                <Button
                  key={d.id}
                  type="text"
                  className={`alp-date-option${dateFilter === d.id ? ' is-active' : ''}`}
                  aria-pressed={dateFilter === d.id}
                  onClick={() => setDateFilter(d.id)}
                >
                  {d.label}
                </Button>
              ))}
            </div>

            {/*
              搜索框走 `Input` 兼容壳的 prefix / suffix, 不再手写
              「div 包图标 + 裸 input + 条件清除键」—— 后者与 Input 的
              `.ant-input-affix-wrapper` 是同一套结构的两份实现。
              清除键用共享 `Button` (variant=ghost) 而不是裸 button。
            */}
            <Input
              className="alp-search"
              prefix={<Search size={14} />}
              suffix={
                keyword ? (
                  <Button
                    type="text"
                    className="alp-search-clear"
                    aria-label="清除搜索"
                    onClick={() => setKeyword('')}
                  >
                    <X size={12} className="size-[12px]" />
                  </Button>
                ) : null
              }
              value={keyword}
              placeholder="搜索素材名称 / 地址"
              onChange={(e) => setKeyword(e.target.value)}
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
                  type="text"
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
                    type="text"
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
                      type="text"
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
                  {visible.map((a) => {
                    const on = selected.includes(a.id);
                    const modality = modalityOfFormat(a.format);
                    // 视频没有缩略图通道, 原样交给 <video>; 图片走方形 JPEG 缩略图
                    const previewUrl =
                      (modality === 'video' ? assetSrc(a) : assetThumbSrc(a, 480)) ?? '';
                    return (
                      <Button
                        key={a.id}
                        type="text"
                        className={`alp-card${on ? ' is-selected' : ''}`}
                        aria-pressed={on}
                        disabled={!on && atLimit}
                        title={!on && atLimit ? `最多选择 ${maxSelectable} 张` : undefined}
                        onClick={() => toggle(a)}
                      >
                        <div className="alp-cover">
                          {/* 视频素材用 <video> —— 浏览器会把 mp4 当图片解码, 表现为空白缩略图 */}
                          <ResultMedia url={previewUrl} modality={modality} alt={a.sourceUrl} />
                          {a.kind === 'original' && (
                            <span className="alp-origin-badge is-original" title="用户上传的原始图片">
                              用户上传
                            </span>
                          )}
                          {a.kind === 'generated' && (
                            <span className="alp-origin-badge is-generated" title="AI 生成的图片">
                              AI 生成
                            </span>
                          )}
                          {a.capability && (
                            <span
                              className="alp-capability"
                              title={`用途：${capabilityLabel(a.capability)}`}
                            >
                              {capabilityLabel(a.capability)}
                            </span>
                          )}
                          {on && (
                            <span className="alp-check" aria-label="已选择">
                              ✓
                            </span>
                          )}
                        </div>
                      </Button>
                    );
                  })}
                </div>
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
              <Button type="text" className="alp-clear" onClick={() => setSelected([])}>
                清除选择
              </Button>
            )}
          </div>
          <div className="alp-footer-actions">
            <Button type="text" className="alp-btn alp-btn-cancel" onClick={onCancel}>
              取消
            </Button>
            <Button
              type="text"
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
