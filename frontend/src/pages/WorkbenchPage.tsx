import { useEffect, useMemo, useState } from 'react';
import { Empty, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp, Images, BarChart3, CheckCircle2 } from 'lucide-react';
import { toAbsoluteUrl, statsApi } from '../lib/api';
import { capabilityById, toolPath } from '../lib/capabilities';
import { CapabilityIcon } from '../components/AppLayout';
import { HeroArt } from '../components/HeroArt';
import { SafeThumb } from '../components/RailPreview';
import type { CapabilityGroup, StatsOverview } from '../types/api';

/**
 * 数据面板 6 格指标 (参考站 `.wb-dashboard-stats` 为 repeat(6) 六格)。
 * 全部取自真实统计接口, 无占位数字。
 */
const DASH_TILES: {
  label: string;
  value: (s: StatsOverview) => string | number;
  foot: (s: StatsOverview) => string;
}[] = [
  { label: '累计生成', value: (s) => s.totals.tasks, foot: (s) => `成功 ${s.totals.succeeded}` },
  {
    label: '成功率',
    value: (s) => (s.totals.successRate === null ? '—' : `${s.totals.successRate}%`),
    foot: () => '成功 / 全部任务',
  },
  { label: '素材库存', value: (s) => s.totals.assets, foot: (s) => `原图 ${s.totals.originals}` },
  { label: '生成图', value: (s) => s.totals.generated, foot: () => '可下载原图' },
  { label: '失败任务', value: (s) => s.totals.failed, foot: () => '可重试' },
  {
    label: '近 7 天',
    value: (s) => s.last7Days.reduce((a, d) => a + d.count, 0),
    foot: () => '张图片产出',
  },
];

/**
 * 工作台: 视觉与信息结构对齐参考站 (ijihua.cn/workbench)。
 *
 * 版面数值来自参考站 computed styles 实拍 (2026-10-17 于 1280x577 视口重拍校正):
 *   内容宽 1142 / hero 1142x212 radius 16 padding 0 100px, 标题 32px/500 #000 lh20,
 *   副标题 17px/400 #667085 lh31 (文案块总高 75 = 20 + margin 24 + 31)
 *   工具网格 6 列 x 177px gap 16 / 卡片 177x197 radius 16 / 缩略图 2:1
 *   图标块 40x40 白底 radius 8 阴影, 跨在缩略图与文字区分界线上 (left 15 / top 69)
 *   标题 14px/600 #171A2B lh16 (旧基准 16px/#333 已按 10-17 实拍修正) / 描述 12px #86909C
 *   数据区 .wb-data-layout: 2:1 双面板 + 通栏, 白底 padding 24 高 268, margin-top 16,
 *   圆角 12 (账号/创作数据) 与 16 (最近任务) — 参考站两面板圆角本身不一致, 按实拍保留
 *
 * 诚实差异:
 *   - 参考站 hero 右侧插画在 bannerbg.png 背景图内; 本项目不引用第三方图片资源, 改为渐变背景
 *     + 用户真实产出拼贴 (绝对定位, 不撑高 hero), 无产出时回退原创 SVG
 *   - 参考站主区是内部滚动容器 (.workspace-route-content), 本地用 window 滚动,
 *     内容区比参考站窄 ~25px (侧栏 99 vs 84 + 滚动条), 故 hero padding 用 84px 补偿,
 *     使文案与参考站落在同一绝对 x=208; 卡片宽度随容器浮动 (173 vs 177)
 *
 * 卡片数据全部来自后端能力清单 (workbenchIds + registry items) 与真实产出
 * (byCapability.thumbnailUrl 取每项能力最近一次成功结果), 前端不硬编码任何能力。
 */
export function WorkbenchPage({
  workbenchIds,
  groups,
}: {
  workbenchIds: string[];
  groups: CapabilityGroup[];
}) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .overview()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  // 类型守卫: filter(Boolean) 不会收窄 undefined, 这里显式过滤
  const cards = useMemo(
    () =>
      workbenchIds
        .map((id) => capabilityById(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [workbenchIds],
  );

  const thumbOf = (capability: string) =>
    toAbsoluteUrl(stats?.byCapability.find((b) => b.capability === capability)?.thumbnailUrl ?? null);

  // hero 右侧作品集: 取最近生成的前 3 张真实产出 (转绝对 URL, 直连后端静态资源)
  const heroThumbs = useMemo(
    () => (stats?.recentTasks ?? []).slice(0, 3).map((t) => toAbsoluteUrl(t.thumbnailUrl)),
    [stats],
  );

  const max7d = Math.max(1, ...(stats?.last7Days ?? []).map((d) => d.count));
  const total7d = (stats?.last7Days ?? []).reduce((a, d) => a + d.count, 0);

  const statusLabel = (s: string) =>
    s === 'succeeded' ? '已完成' : s === 'failed' ? '失败' : '进行中';

  /** 能力所属分组 (用于流水表的「业务类型」列, 取能力清单真实分组)
   *  2026-10-19: 原先在这里把 group id 硬映射成中文名, 与后端 registry 下发的
   *  CapabilityGroup.name 重复实现, 且 `return 'AI视频'` 兜底会让后端新增第 4 组时
   *  全部落到「AI视频」。改为直接读下发的 groups, 新增分组零改前端。 */
  const groupOf = (capability: string): string => {
    const g = capabilityById(capability)?.group;
    return groups.find((x) => x.id === g)?.name ?? '';
  };

  return (
    <div className="workbench">
      <section className="wb-hero">
        <div className="wb-hero-text">
          <h1 className="wb-hero-title">把电商运营，组织成一条工作流</h1>
          <p className="wb-hero-sub">
            继续你的商品内容创作，查看账号状态、任务进度和创作数据。
          </p>
        </div>
        <HeroArt className="wb-hero-art" thumbs={heroThumbs} />
      </section>

      <section className="wb-tools">
        {cards.map((c) => {
          const thumb = thumbOf(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`wb-card wb-card-${c.mode}`}
              onClick={() => (c.mode === 'planned' ? undefined : navigate(toolPath(c.id)))}
              disabled={c.mode === 'planned'}
            >
              <span className="wb-card-thumb">
                <span className="wb-card-thumb-clip">
                  <SafeThumb
                    src={thumb ?? ''}
                    alt={`${c.name}示例`}
                    fallback={
                      <span className="wb-card-thumb-empty">
                        <CapabilityIcon id={c.id} size={26} />
                      </span>
                    }
                  />
                </span>
                {c.badge && <span className="wb-card-badge">{c.badge}</span>}
                {c.mode === 'planned' && <span className="wb-card-badge wb-card-badge-planned">规划中</span>}
                {c.mode === 'mock' && <span className="wb-card-badge wb-card-badge-mock">占位</span>}
              </span>
              {/* 参考 .wb-tool-icon 是 .wb-tool-card 的直接子节点 (定位基准=卡片, bottom 88 / left 15),
                  故不放进 .wb-card-thumb, 否则会以缩略图为基准溢出卡片 */}
              <span className="wb-card-icon">
                <CapabilityIcon id={c.id} size={22} />
              </span>
              <span className="wb-card-body">
                <span className="wb-card-title">{c.name}</span>
                <span className="wb-card-desc">{c.summary}</span>
              </span>
            </button>
          );
        })}
      </section>

      {/* 数据区: 上排 2:1 双面板 (账号 / 最近任务), 下排通栏数据面板
          数值全部来自参考站样式产物 `.wb-*` (2026-10-17 提取):
          wb-data-layout      minmax(0,2fr) minmax(300px,1fr) gap16 margin 16 0
          wb-panel            #fff radius12 min-width 0
          wb-recent           radius16 (参考站自身圆角不一致, 按实拍保留)
          wb-account/recent/dashboard  padding 24 (窄屏 16)
          wb-panel-title      flex space-between center gap12; 按钮 12px #667085 inline-flex gap3
          wb-account-metrics  grid 1fr 1fr 1.35fr gap16; 块 #F2F4F7 radius8 padding 20 24
          wb-account th/td    th #4E5564 bg #F2F4F7 padding 9 12 fw500 / td border-bottom #EFF0F4 padding 9 12
          wb-flow-type        inline-block radius4 padding 2 7 11px/15px
          wb-jobs-list        flex column gap24 margin-top24
          wb-job              thumb 80x80 radius8 #F2F3F7 / copy flex1 / status flex 0 0 80px 14px
          wb-jobs-empty       #98A0AF center padding 100px 0 13px
          wb-dashboard-stats  repeat(6,minmax(0,1fr)) gap16 margin-top24; 块 #F2F4F7 radius8 padding24
          wb-dashboard-head   flex space-between center gap12; 首列 span = chip border #E5E7EF radius14 padding 7 12
          wb-chart-title      margin 24 0 12 font13
          wb-trend-chart      width 100% height 210 */}
      <section className="wb-panels">
        <div className="wb-panel wb-account">
          <div className="wb-panel-head">
            <h3>账号和作品数据</h3>
            <button type="button" className="wb-panel-link" onClick={() => navigate('/stats')}>
              完整数据 <ArrowRight size={12} />
            </button>
          </div>
          {loading ? (
            <div className="wb-panel-loading">
              <Spin size="small" />
            </div>
          ) : stats ? (
            <>
              <div className="wb-account-metrics">
                <div className="wb-metric-block">
                  <span className="wb-stat-label">
                    <TrendingUp size={13} /> 累计生成
                  </span>
                  <span className="wb-stat-value">{stats.totals.tasks}</span>
                  <span className="wb-stat-foot">
                    成功率 {stats.totals.successRate === null ? '—' : `${stats.totals.successRate}%`}
                  </span>
                </div>
                <div className="wb-metric-block">
                  <span className="wb-stat-label">
                    <Images size={13} /> 素材库存
                  </span>
                  <span className="wb-stat-value">{stats.totals.assets}</span>
                  <span className="wb-stat-foot">
                    原图 {stats.totals.originals} · 生成图 {stats.totals.generated}
                  </span>
                </div>
                <div className="wb-metric-block">
                  <span className="wb-stat-label">
                    <BarChart3 size={13} /> 近 7 天创作
                  </span>
                  <span className="wb-stat-value">{total7d}</span>
                  <span className="wb-stat-foot">张图片产出</span>
                </div>
              </div>

              {/* 账号流水表: 版式取参考站 .wb-account th/td + .wb-flow-type;
                  本地无积分/计费体系, 列的是真实任务记录而非消耗金额 */}
              <div className="wb-flow-table-wrap">
                <table className="wb-flow-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>能力</th>
                      <th>业务类型</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentTasks.slice(0, 4).map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.createdAt
                            ? new Date(t.createdAt).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : '—'}
                        </td>
                        <td>{t.name}</td>
                        <td>
                          <span className={`wb-flow-type flow-${groupOf(t.capability)}`}>
                            {groupOf(t.capability)}
                          </span>
                        </td>
                        <td>{statusLabel(t.status)}</td>
                      </tr>
                    ))}
                    {stats.recentTasks.length === 0 && (
                      <tr>
                        <td colSpan={4} className="wb-table-empty">
                          暂无记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="wb-panel-note">
                <CheckCircle2 size={13} /> 本地算法运行，不限次数；接入模型后同一入口返回真实结果。
              </p>
            </>
          ) : (
            <Empty description="数据加载失败，请确认后端已启动" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>

        <div className="wb-panel wb-panel-recent">
          <div className="wb-panel-head">
            <h3>最近任务</h3>
            <button type="button" className="wb-panel-link" onClick={() => navigate('/works')}>
              全部作品 <ArrowRight size={12} />
            </button>
          </div>
          {loading ? (
            <div className="wb-panel-loading">
              <Spin size="small" />
            </div>
          ) : stats && stats.recentTasks.length > 0 ? (
            <div className="wb-jobs-list">
              {stats.recentTasks.slice(0, 4).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="wb-job"
                  onClick={() => navigate('/works')}
                >
                  <span className="wb-job-thumb">
                    {t.thumbnailUrl ? (
                      <img src={toAbsoluteUrl(t.thumbnailUrl)} alt="" loading="lazy" />
                    ) : (
                      <CapabilityIcon id={t.capability} size={18} />
                    )}
                  </span>
                  <span className="wb-job-copy">
                    <span className="wb-job-name">{t.name}</span>
                    <span className="wb-job-time">
                      {t.createdAt
                        ? new Date(t.createdAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })
                        : ''}
                    </span>
                  </span>
                  <span className={`wb-job-status status-${t.status}`}>{statusLabel(t.status)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="wb-jobs-empty">还没有生成记录，去工作台创建第一条</div>
          )}
        </div>
      </section>

      <section className="wb-panel wb-panel-dashboard">
        <div className="wb-panel-head wb-dashboard-head">
          <h3>创作数据</h3>
          <span className="wb-dashboard-chip">近 7 天</span>
        </div>
        {loading ? (
          <div className="wb-panel-loading">
            <Spin size="small" />
          </div>
        ) : stats ? (
          <>
            <div className="wb-dashboard-stats">
              {DASH_TILES.map((t) => (
                <div key={t.label} className="wb-metric-block">
                  <span className="wb-stat-label">{t.label}</span>
                  <span className="wb-stat-value">{t.value(stats)}</span>
                  <span className="wb-stat-foot">{t.foot(stats)}</span>
                </div>
              ))}
            </div>
            <div className="wb-chart-title">每日产出（近 7 天）</div>
            <div className="wb-trend-chart">
              {stats.last7Days.map((d) => (
                <div key={d.date} className="wb-trend-col">
                  <span className="wb-trend-count">{d.count > 0 ? d.count : ''}</span>
                  <span className="wb-trend-bar-wrap">
                    <span
                      className="wb-trend-bar"
                      style={{ height: `${Math.round((d.count / max7d) * 100)}%` }}
                    />
                  </span>
                  <span className="wb-trend-date">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Empty description="数据加载失败" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </section>
    </div>
  );
}
