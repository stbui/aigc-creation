import { Check, ChevronDown, Download, Search } from 'lucide-react';

import type { DatePreset } from './constants';
import { capabilityName } from './utils';
import type { WorksFilters } from './useWorksFilters';

/**
 * 我的作品 · 工具栏。
 *
 * 四个筛选浮层（业务类型 / 日期 / 状态 / 所属任务）+「清除筛选」+「下载所选」。
 * 2026-11-04 从 `page.tsx` 的 594 行连续 JSX 中抽出；筛选状态仍由
 * `useWorksFilters` 持有，本组件只负责渲染与转发事件；`filters` 整体传入后
 * 在函数体内解构，不把 20 多个筛选字段摊成 props。
 *
 * 浮层的关闭依赖两处：`onMouseLeave`（桌面端移出工具栏）与 document 上的
 * pointerdown / Escape（移动端没有 mouseleave），后者在 `useWorksFilters` 里。
 */

export interface WorksToolbarProps {
  /** 筛选状态全集（`useWorksFilters` 的返回值），下方解构的字段与其同名 */
  filters: WorksFilters;
  /** 已勾选作品 id（「下载所选」按钮上的计数） */
  selected: string[];
  /** 已勾选且已出图的数量：为 0 时下载按钮禁用 */
  downloadableSelected: number;
  downloadSelected: () => void;
}

export function WorksToolbar({
  filters,
  selected,
  downloadableSelected,
  downloadSelected,
}: WorksToolbarProps) {
  const {
    biz,
    setBiz,
    bizOpen,
    setBizOpen,
    bizGroups,
    datePreset,
    setDatePreset,
    dateOpen,
    setDateOpen,
    customRange,
    setCustomRange,
    status,
    setStatus,
    statusOpen,
    setStatusOpen,
    taskQuery,
    setTaskQuery,
    taskOpen,
    setTaskOpen,
    taskPick,
    setTaskPick,
    matchedTasks,
    activeFilterCount,
    closeAll,
    toggleIn,
  } = filters;

  return (
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
                  onChange={(e) => {
                    setCustomRange([e.target.value, customRange[1]]);
                    // 之前只更新范围、不切换 preset，过滤分支永远不会读它
                    setDatePreset('custom');
                  }}
                />
                <span>至</span>
                <input
                  type="date"
                  value={customRange[1]}
                  onChange={(e) => {
                    setCustomRange([customRange[0], e.target.value]);
                    setDatePreset('custom');
                  }}
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

      {/* 清除筛选紧跟筛选器 (次要动作), 主操作「选择下载」守在工具栏右端 */}
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

      <button
        type="button"
        className="my-works-download"
        disabled={downloadableSelected === 0}
        title={downloadableSelected === 0 ? '请先勾选已生成成功的作品' : undefined}
        onClick={downloadSelected}
      >
        <Download size={14} />
        下载所选{selected.length > 0 ? ` (${selected.length})` : ''}
      </button>
    </div>
  );
}
