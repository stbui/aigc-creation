import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import {
  Check,
  ChevronDown,
  Download,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { generateApi, toAbsoluteUrl } from '../lib/api';
import { capabilityById, capabilityName, toolPath } from '../lib/capabilities';
import { useCapabilities } from '../hooks/useCapabilities';
import { StateError, StateSkeleton } from '../components/StateViews';
import { ResultMedia } from '../components/ResultMedia';
import type { Task } from '../types/api';

/**
 * 我的作品 —— 1:1 复刻参考站 https://ijihua.cn/my-works。
 *
 * 版面数值来源（2026-10-17）:
 *   ① 未登录可达空态实拍: `.my-works-page` 1190 宽 padding `28px 28px 72px`、bg #F6F7FB;
 *      h1 38.4px/600 #161616; 双 tab 56×32; 工具栏 `.my-works-toolbar` 白底 radius16
 *      padding `12px 14px` shadow rgba(41,33,22,.04) 0 12px 30; 4 个筛选器各 108×37
 *      (12px #5F5B55 / border #EBE8E1 / radius 999); 「选择下载」97×33 白字 radius 999;
 *      计数 13px #4D4943; 排序说明 12px #96918A; 空态 h2 18px/700 #3D3934
 *   ② 卡片区（登录墙内）取自参考站**样式产物** `/assets/index-*.css`（未混淆，类名可直读）:
 *      `.my-works-grid` repeat(6, minmax(0,1fr)) gap 16 align-items start（≤某断点降 5 列）
 *      `.my-work-meta` absolute top 10 left 10, flex gap 9, z7, pointer-events none
 *      `.my-work-card.selected` outline #6C5CE7; `.my-work-check` 选中 #6C5CE7
 *      `.my-works-selection-bar` 12px / #5B4BD7 on #F1EFFF / padding `10px 14px` / radius 9
 *      按钮 11px 白字 radius 999 padding `6px 10px`
 *      `.my-works-load-more` min-height 58 / 12px #9A958D
 *      `.my-works-empty` min-height 300 / #9A958D / align-content center / gap 8
 *      `.my-works-tabs` border-bottom #ECE9E3 gap 24, 按钮 14px/600 #8B8F9B padding `0 0 12px`
 *      `.my-works-filter-popover` 白底 radius12 padding16 shadow rgba(33,31,27,.14) 0 16px 36
 *      业务类型 330×318（分组多选）· 日期 308×229 · 状态 214×167 · 所属任务 318×159
 *
 * 诚实差异:
 *   - 「视频作品」页签保留但如实标注本地无视频能力（点击提示），不渲染假内容
 *   - 浮层内「重绘」工具列本地真实可跳转的工具页；未实现的项不出现
 *   - 所属任务筛选按**任务 ID / 能力名**检索本地真实任务（参考站为云端任务 ID）
 */

/** 参考站日期筛选的快捷项（本地按真实日期区间过滤） */
type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | 'custom';

const PAGE_SIZE = 24;

const STATUS_LABEL: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  running: '生成中',
  pending: '生成中',
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function WorksPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { data: caps } = useCapabilities();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 加载失败必须与「没有作品」分开存。
   *
   * 2026-10-20 修: 此前失败只 `message.error` 弹一下, 然后照样落进空态分支
   * 渲染「还没有作品」—— 用户看到的是"你还没有作品", 而真相是"接口没连上"。
   * 这会让人以为作品丢了而反复重试, 属于**谎报状态**。
   */
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'image' | 'video'>('image');

  // 四个筛选器（与参考站一致的多选/单选语义）
  const [bizOpen, setBizOpen] = useState(false);
  const [biz, setBiz] = useState<string[]>([]);
  const [dateOpen, setDateOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customRange, setCustomRange] = useState<[string, string]>(['', '']);
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskPick, setTaskPick] = useState<string[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await generateApi.list());
    } catch (e) {
      // 保留上一次数据: 刷新失败不该把已看到的作品清空
      setError((e as Error).message || '作品列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeAll = () => {
    setBizOpen(false);
    setDateOpen(false);
    setStatusOpen(false);
    setTaskOpen(false);
  };

  // ── 真实过滤（全部基于本地任务数据，不做假筛选）──
  const filtered = useMemo(() => {
    const now = new Date();
    return tasks.filter((t) => {
      if (biz.length > 0 && !biz.includes(t.capability)) return false;
      if (status.length > 0) {
        const bucket = t.status === 'succeeded' ? 'succeeded' : t.status === 'failed' ? 'failed' : 'running';
        if (!status.includes(bucket)) return false;
      }
      if (taskPick.length > 0 && !taskPick.includes(t.id)) return false;
      const ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (datePreset === 'today' && ts < startOfDay(now)) return false;
      if (datePreset === 'yesterday') {
        const y = startOfDay(now) - 86400000;
        if (ts < y || ts >= startOfDay(now)) return false;
      }
      if (datePreset === '7d' && ts < startOfDay(now) - 6 * 86400000) return false;
      if (datePreset === 'custom' && customRange[0] && customRange[1]) {
        const from = startOfDay(new Date(customRange[0]));
        const to = startOfDay(new Date(customRange[1])) + 86400000;
        if (ts < from || ts >= to) return false;
      }
      return true;
    });
  }, [tasks, biz, status, taskPick, datePreset, customRange]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      ),
    [filtered],
  );

  const visible = sorted.slice(0, visibleCount);
  const activeFilterCount =
    biz.length + status.length + taskPick.length + (datePreset === 'all' ? 0 : 1);

  const toggleIn = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const cardOf = (t: Task) => capabilityById(t.capability);

  const removeTask = async (id: string) => {
    try {
      await generateApi.remove(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setSelected((prev) => prev.filter((x) => x !== id));
      message.success('已删除作品及其生成图');
    } catch (e) {
      message.error((e as Error).message || '删除失败');
    }
  };

  const downloadSelected = () => {
    const list = tasks.filter((t) => selected.includes(t.id) && t.outputAsset);
    list.forEach((t, i) => {
      const url = toAbsoluteUrl(t.outputAsset!.sourceUrl);
      if (!url) return;
      window.setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t.capability}-${t.id.slice(-6)}.${t.outputAsset!.format === 'png' ? 'png' : 'jpg'}`;
        a.click();
      }, i * 220);
    });
    message.success(`已下载 ${list.length} 张作品`);
  };

  // 作品页只按「电商生图 / AI修图」分组, 与顶导/落地页口径一致 (参考站这两处均两组)。
    // 分组名直接取后端下发的 g.name, 不在前端硬编码中文名。
    const bizGroups = useMemo(() => {
      const items = caps?.items ?? [];
      return (caps?.groups ?? [])
        .filter((g) => g.id === 'ecommerce_gen' || g.id === 'ai_retouch')
        .map((g) => ({ name: g.name, items: items.filter((i) => i.group === g.id) }));
    }, [caps]);

  const matchedTasks = useMemo(() => {
    const q = taskQuery.trim();
    if (!q) return tasks.slice(0, 20);
    return tasks
      .filter((t) => capabilityName(t.capability).includes(q) || t.id.includes(q))
      .slice(0, 20);
  }, [tasks, taskQuery]);

  return (
    <div className="my-works-page">
      <div className="my-works-head">
        <h1>我的作品</h1>
        <div className="my-works-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'image'}
            className={tab === 'image' ? 'is-active' : ''}
            onClick={() => setTab('image')}
          >
            图片作品
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'video'}
            className={tab === 'video' ? 'is-active' : ''}
            onClick={() =>
              message.info('本地演示未接入视频生成能力，暂只提供图片作品')
            }
          >
            视频作品
          </button>
        </div>
      </div>

      <div className="my-works-toolbar" onMouseLeave={closeAll}>
        {/* 业务类型（分组多选） */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${biz.length > 0 ? ' active' : ''}${bizOpen ? ' is-open' : ''}`}
            aria-expanded={bizOpen}
            onClick={() => {
              closeAll();
              setBizOpen((v) => !v);
            }}
          >
            业务类型
            {biz.length > 0 && <span className="my-works-filter-badge">{biz.length}</span>}
            <ChevronDown size={13} />
          </button>
          {bizOpen && (
            <div className="my-works-filter-popover my-works-business-popover">
              <div className="my-works-popover-head">
                <strong>业务类型</strong>
                <span>可多选 · 选择后立即生效</span>
              </div>
              <button
                type="button"
                className={`my-works-business-all${biz.length === 0 ? ' selected' : ''}`}
                onClick={() => setBiz([])}
              >
                <span className={`my-works-checkbox${biz.length === 0 ? ' on' : ''}`}>
                  {biz.length === 0 && <Check size={11} />}
                </span>
                全部
              </button>
              {bizGroups.map((g) => (
                <div key={g.name} className="my-works-option-group">
                  <span className="my-works-option-group-title">{g.name}</span>
                  <div className="my-works-option-chips">
                    {g.items.map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className={`my-works-option-chip${biz.includes(i.id) ? ' selected' : ''}`}
                        onClick={() => toggleIn(biz, i.id, setBiz)}
                      >
                        {i.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 日期 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${datePreset !== 'all' ? ' active' : ''}${dateOpen ? ' is-open' : ''}`}
            aria-expanded={dateOpen}
            onClick={() => {
              closeAll();
              setDateOpen((v) => !v);
            }}
          >
            日期
            <ChevronDown size={13} />
          </button>
          {dateOpen && (
            <div className="my-works-filter-popover my-works-date-popover">
              <div className="my-works-popover-head">
                <strong>日期</strong>
                <span>只精确到日期</span>
              </div>
              <div className="my-works-date-pills">
                {(
                  [
                    ['all', '全部'],
                    ['today', '今天'],
                    ['yesterday', '昨天'],
                    ['7d', '近 7 天'],
                  ] as [DatePreset, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={datePreset === v ? 'selected' : ''}
                    onClick={() => setDatePreset(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="my-works-custom-date">
                <span className="my-works-custom-date-label">自定义日期范围</span>
                <div className="my-works-date-fields">
                  <input
                    type="date"
                    value={customRange[0]}
                    onChange={(e) => setCustomRange([e.target.value, customRange[1]])}
                  />
                  <span>至</span>
                  <input
                    type="date"
                    value={customRange[1]}
                    onChange={(e) => setCustomRange([customRange[0], e.target.value])}
                  />
                </div>
                <span className="my-works-custom-date-hint">包含开始日和结束日</span>
              </div>
            </div>
          )}
        </div>

        {/* 状态 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${status.length > 0 ? ' active' : ''}${statusOpen ? ' is-open' : ''}`}
            aria-expanded={statusOpen}
            onClick={() => {
              closeAll();
              setStatusOpen((v) => !v);
            }}
          >
            状态
            <ChevronDown size={13} />
          </button>
          {statusOpen && (
            <div className="my-works-filter-popover my-works-status-popover">
              <div className="my-works-popover-head">
                <strong>状态</strong>
                <span>按作品状态筛选</span>
              </div>
              <div className="my-works-status-pills">
                {(
                  [
                    ['succeeded', '成功'],
                    ['running', '生成中'],
                    ['failed', '失败'],
                  ] as [string, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={status.includes(v) ? 'selected' : ''}
                    onClick={() => toggleIn(status, v, setStatus)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 所属任务 */}
        <div className="my-works-filter-wrap">
          <button
            type="button"
            className={`my-works-filter-trigger${taskPick.length > 0 ? ' active' : ''}${taskOpen ? ' is-open' : ''}`}
            aria-expanded={taskOpen}
            onClick={() => {
              closeAll();
              setTaskOpen((v) => !v);
            }}
          >
            所属任务
            <ChevronDown size={13} />
          </button>
          {taskOpen && (
            <div className="my-works-filter-popover my-works-task-popover">
              <div className="my-works-popover-head">
                <strong>所属任务</strong>
                <span>支持任务 ID 或能力名称搜索</span>
              </div>
              <label className="my-works-task-search">
                <Search size={13} />
                <input
                  value={taskQuery}
                  placeholder="搜索任务"
                  onChange={(e) => setTaskQuery(e.target.value)}
                />
              </label>
              <div className="my-works-task-list">
                <button
                  type="button"
                  className={taskPick.length === 0 ? 'selected' : ''}
                  onClick={() => setTaskPick([])}
                >
                  全部任务
                </button>
                {matchedTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={taskPick.includes(t.id) ? 'selected' : ''}
                    onClick={() => toggleIn(taskPick, t.id, setTaskPick)}
                  >
                    <span>{capabilityName(t.capability)}</span>
                    <small>{t.id.slice(-8)}</small>
                  </button>
                ))}
                {matchedTasks.length === 0 && <span className="my-works-task-empty">无匹配任务</span>}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="my-works-download"
          disabled={selected.length === 0}
          onClick={downloadSelected}
        >
          <Download size={13} /> 选择下载{selected.length > 0 ? ` (${selected.length})` : ''}
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            className="my-works-filter-clear"
            onClick={() => {
              setBiz([]);
              setStatus([]);
              setTaskPick([]);
              setDatePreset('all');
              setCustomRange(['', '']);
            }}
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 多选操作条（选择任一卡片后出现，实测 spec: #5B4BD7 on #F1EFFF） */}
      {selected.length > 0 && (
        <div className="my-works-selection-bar">
          <span>已选 {selected.length} 张作品</span>
          <button type="button" onClick={downloadSelected}>
            <Download size={11} /> 下载所选
          </button>
          <button
            type="button"
            className="my-works-selection-exit"
            onClick={() => setSelected([])}
          >
            取消选择
          </button>
        </div>
      )}

      <div className="my-works-count-row">
        <span>{sorted.length} 张作品</span>
        <span className="my-works-sort-label">按创作日期倒序</span>
        <button type="button" className="my-works-refresh" onClick={() => void load()}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      {loading ? (
        /* 骨架屏占住卡片网格的形状 —— 内容到达时零位移;
           此前是居中一个转圈, 网格区域整块塌陷再撑开, 页面明显跳动。 */
        <StateSkeleton variant="card" count={12} columns={6} />
      ) : error ? (
        /* 失败态与空态必须分开: 「没连上」不是「没有作品」 */
        <StateError
          title="作品列表加载失败"
          desc="没能取回你的作品列表。可能是后端未启动或网络异常，重试一次即可。"
          detail={error}
          onRetry={() => void load()}
        />
      ) : visible.length === 0 ? (
        <div className="my-works-empty">
          <h2>{activeFilterCount > 0 ? '没有符合条件的作品' : '还没有作品'}</h2>
          <p>
            {activeFilterCount > 0
              ? '试试放宽筛选条件，或清除全部筛选。'
              : '完成一次创作后，作品会出现在这里。'}
          </p>
        </div>
      ) : (
        <>
          <div className="my-works-grid">
            {visible.map((t) => {
              const url = t.outputAsset ? toAbsoluteUrl(t.outputAsset.sourceUrl) : undefined;
              const isSel = selected.includes(t.id);
              return (
                <article key={t.id} className={`my-work-card${isSel ? ' selected' : ''}`}>
                  <button
                    type="button"
                    className="my-work-image-button"
                    onClick={() => {
                      const def = cardOf(t);
                      if (def) navigate(toolPath(def.id));
                    }}
                  >
                    {url ? (
                      <ResultMedia
                        url={url}
                        modality={t.outputAsset?.modality}
                        alt={capabilityName(t.capability)}
                      />
                    ) : (
                      <span className="my-work-image-placeholder">
                        {t.status === 'failed' ? (
                          <>
                            <ImageOff size={18} />
                            <small>生成失败</small>
                          </>
                        ) : (
                          <>
                            <Loader2 size={18} className="my-work-generating-spinner" />
                            <small>生成中</small>
                          </>
                        )}
                      </span>
                    )}

                    {/* meta: absolute top10 left10 (实拍) */}
                    <span className="my-work-meta">
                      <span className={`my-work-tag status-${t.status}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      <span className="my-work-tag">{capabilityName(t.capability)}</span>
                    </span>

                    {/* hover 浮层: 顶部再来一张 / 底部操作 */}
                    <span className="my-work-hover-actions">
                      <span className="my-work-hover-top">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            const def = cardOf(t);
                            if (def) navigate(toolPath(def.id));
                          }}
                        >
                          <Sparkles size={12} /> 再来一张
                        </span>
                      </span>
                      <span className="my-work-hover-bottom">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (url) window.open(url, '_blank', 'noopener');
                          }}
                        >
                          下载
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeTask(t.id);
                          }}
                        >
                          <Trash2 size={12} /> 删除
                        </span>
                      </span>
                    </span>
                  </button>

                  {/* 勾选（多选下载） */}
                  <label className="my-work-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleIn(selected, t.id, setSelected)}
                    />
                    <span>{isSel && <Check size={11} />}</span>
                  </label>

                  <div className="my-work-caption">
                    <span>{capabilityName(t.capability)}</span>
                    <small>
                      {t.createdAt
                        ? new Date(t.createdAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })
                        : ''}
                      {t.outputAsset ? ` · ${t.outputAsset.width}×${t.outputAsset.height}` : ''}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>

          {visibleCount < sorted.length && (
            <button
              type="button"
              className="my-works-load-more"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              <ChevronDown size={14} /> 加载更多（剩余 {sorted.length - visibleCount} 张）
            </button>
          )}
        </>
      )}
    </div>
  );
}
