import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { toAbsoluteUrl, statsApi } from '../lib/api';
import { capabilityById, isCapabilityVisible, toolPath } from '../lib/capabilities';
import { CapabilityIcon } from '../components/AppLayout';
import { StateError, StateSkeleton } from '../components/StateViews';
import { runtimeOf } from '../lib/constants';
import { useAuth } from '../context/AuthContext';
import { useCredits } from '../context/CreditsContext';
import type { CapabilityGroup, StatsOverview } from '../types/api';

/** 参考站工作台固定示例图与菜单图标；与能力 id 一一对应。 */
const WORKBENCH_ART: Record<string, { image: string; icon: string }> = {
  main_image: { image: '/workbench/spzt.webp', icon: '/workbench/icons/m_spzt.svg' },
  detail_image: { image: '/workbench/spxq.webp', icon: '/workbench/icons/m_spxq.svg' },
  hot_remake: { image: '/workbench/bkfk.webp', icon: '/workbench/icons/m_bkfk.svg' },
  creative_image: { image: '/workbench/cyst.webp', icon: '/workbench/icons/m_cyst.svg' },
  local_redraw: { image: '/workbench/jbch.webp', icon: '/workbench/icons/m_jbch.svg' },
  expand: { image: '/workbench/znkt.webp', icon: '/workbench/icons/m_znkt.svg' },
  matting: { image: '/workbench/bjxc.webp', icon: '/workbench/icons/m_bjxc.svg' },
  remove_watermark: { image: '/workbench/qcsy.webp', icon: '/workbench/icons/m_qcsy.svg' },
  image_translate: { image: '/workbench/tpfy.webp', icon: '/workbench/icons/m_tpfy.svg' },
  enhance: { image: '/workbench/cpjx.webp', icon: '/workbench/icons/m_cpjx.svg' },
  recolor: { image: '/workbench/sphs.webp', icon: '/workbench/icons/m_sphs.svg' },
  rotate: { image: '/workbench/xzjd.webp', icon: '/workbench/icons/m_jdxz.svg' },
};

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
 * 版面数值来自参考站 computed styles 实拍 (2026-10-17 于 1280x577 视口重拍校正,
 * 2026-10-19 于 1280x800 复验一致):
 *   内容宽 = 视口 − 侧栏 − 48 全宽无上限 (参考站同构, 2026-10-19 取消 1142 上限),
 *   hero 212 高 radius 16 padding 0 100px, 标题 32px/500 #000 lh20, 副标题 17px/400 #667085 lh31
 *   (文案块总高 75 = 20 + margin 24 + 31)
 *   工具网格 6 列 x 178px gap 16 / 卡片 178x197 radius 16 / 缩略图 2:1
 *   图标块 40x40 白底 radius 8 阴影, 跨在缩略图与文字区分界线上 (left 15 / top 69)
 *   标题 14px/600 #171A2B lh16 (旧基准 16px/#333 已按 10-17 实拍修正) / 描述 12px #86909C
 *   数据区 .wb-data-layout: 2:1 双面板 + 通栏, 白底 padding 24 高 268, margin-top 16,
 *   圆角 12 (账号/创作数据) 与 16 (最近任务) — 参考站两面板圆角本身不一致, 按实拍保留
 *
 * 资源与差异:
 *   - hero 使用参考站 bannerbg.png 的本地副本; 12 张卡片示例图与菜单图标同样本地化,
 *     运行时不请求参考站资源
 *   - 参考站工作台固定 12 张电商生图/修图卡; AI 视频保留在侧栏与工具页
 *   - 参考站主区是内部滚动容器 (.workspace-route-content), 本地用 window 滚动
 *   - 2026-10-19: 侧栏改为自动塌缩 (2026-10-28 精确定点为 ≤1366px / ≥1367px) 的
 *     参考站 100px 垂直轨 (原写死 176px),
 *     hero padding 同步回归参考站字面值 100px (原 84px 是按 ~100px 侧栏的补偿值,
 *     在 176px 侧栏下反而偏 16px); 轨态标题 x=208 / 横排态 x=300, 与参考站
 *     1280/1440 实测一致; 卡片宽随容器浮动, 1280 下 178 与参考站相同
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
  const { token, email, openLogin } = useAuth();
  const { balance } = useCredits();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  /**
   * 加载失败必须单独记录 (2026-10-20 修)。
   * 此前 `catch(() => setStats(null))` 把失败与"没数据"压成同一个 null,
   * 渲染时只能给一句「数据加载失败」, 但没有重试入口, 也没有区分
   * "接口没连上"与"确实还没有记录"。
   */
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    statsApi
      .overview()
      .then((s) => setStats(s))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '统计数据加载失败');
        setStats(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!token) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    load();
  }, [token, load]);

  // 类型守卫: filter(Boolean) 不会收窄 undefined, 这里显式过滤
  const cards = useMemo(
    () =>
      workbenchIds
        .map((id) => capabilityById(id))
        // 与侧栏/顶导同一口径：运营下线的能力不保留一张点不动的卡片。
        .filter((c): c is NonNullable<typeof c> => Boolean(c) && isCapabilityVisible(c!)),
    [workbenchIds],
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
    <div className="workbench-content">
      <section className="wb-workflow-banner" aria-label="工作台引导">
        <div>
          <h1>把电商运营，组织成一条工作流</h1>
          <p>继续你的商品内容创作，查看账号状态、任务进度和创作数据。</p>
        </div>
      </section>

      <section className="wb-tool-section" aria-label="创作工具">
        <div className="wb-tool-grid">
        {cards.map((c) => {
          const art = WORKBENCH_ART[c.id];
          // 运行时结论：运营下线的能力不可点，占位只在「确实走占位」时才标
          const rt = runtimeOf(c);
          const closed = c.mode === 'planned' || rt.effective === 'disabled';
          const unavailable = rt.effective === 'unavailable';
          return (
            <button
              key={c.id}
              type="button"
              className={`wb-tool-card wb-card-${c.mode}`}
              onClick={() => (closed ? undefined : navigate(toolPath(c.id)))}
              disabled={closed}
              title={
                rt.effective === 'disabled'
                  ? rt.reason || '该能力已下线'
                  : unavailable
                    ? rt.reason || '该能力暂无可用模型通道'
                    : undefined
              }
            >
              <div className={`wb-tool-visual${art ? '' : ' wb-tool-visual--empty'}`}>
                {art ? (
                  <img src={art.image} alt={`${c.name}示例`} loading="lazy" />
                ) : (
                  <CapabilityIcon id={c.id} size={26} />
                )}
              </div>
              <span
                className="wb-tool-icon"
                style={art ? ({ '--wb-tool-icon': `url(${art.icon})` } as CSSProperties) : undefined}
              >
                {art ? <img src={art.icon} alt="" aria-hidden /> : <CapabilityIcon id={c.id} size={22} />}
              </span>
              <div className="wb-tool-copy">
                <div className="wb-tool-title">
                  <strong>{c.name}</strong>
                  {c.badge && <em>{c.badge}</em>}
                  {c.mode === 'planned' && <em>规划中</em>}
                  {c.mode !== 'planned' && rt.effective === 'disabled' && <em>已下线</em>}
                  {c.mode !== 'planned' && rt.effective === 'unavailable' && <em>暂不可用</em>}
                </div>
                <span>{c.summary}</span>
              </div>
            </button>
          );
        })}
        </div>
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
      <section className="wb-data-layout" aria-label="账号和作品数据">
        <article className="wb-panel wb-account">
          {!token ? (
            <div className="wb-login-prompt">
              <p>登录后查看可用积分和创作消费</p>
              <button type="button" onClick={openLogin}>登录查看</button>
            </div>
          ) : (
            <>
              <div className="wb-panel-title">
                <strong>账号和作品数据</strong>
                <button type="button" onClick={() => navigate('/credits')}>
                  积分明细 <ArrowRight size={12} />
                </button>
              </div>
              <div className="wb-user">
                <span className="wb-avatar">{(email?.[0] ?? 'U').toUpperCase()}</span>
                <span>{email}</span>
              </div>
              {loading ? (
                <StateSkeleton variant="panel" count={3} />
              ) : error ? (
                <StateError
                  title="数据加载失败"
                  desc="没能取回账号与作品数据。可能是后端未启动或网络异常，重试一次即可。"
                  detail={error}
                  onRetry={load}
                  compact
                />
              ) : stats ? (
                <>
                  <div className="wb-account-metrics">
                    <div>
                      <span>可用积分</span>
                      <b>{balance?.balance ?? '—'}</b>
                      <span>累计获得 {balance?.totalEarned ?? 0}</span>
                    </div>
                    <div>
                      <span>累计生成</span>
                      <b>{stats.totals.tasks}</b>
                      <span>成功率 {stats.totals.successRate === null ? '—' : `${stats.totals.successRate}%`}</span>
                    </div>
                    <div>
                      <span>素材库存</span>
                      <b>{stats.totals.assets}</b>
                      <span>原图 {stats.totals.originals} · 生成图 {stats.totals.generated}</span>
                    </div>
                  </div>
                  <div className="wb-flow-head">
                    <strong>最近任务</strong>
                    <button type="button" onClick={() => navigate('/works')}>查看全部</button>
                  </div>
                  <div className="wb-flow-table-wrap">
                    <table>
                      <thead>
                        <tr><th>时间</th><th>能力</th><th>业务类型</th><th>状态</th></tr>
                      </thead>
                      <tbody>
                        {stats.recentTasks.slice(0, 4).map((t) => (
                          <tr key={t.id}>
                            <td>{t.createdAt ? new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                            <td>{t.name}</td>
                            <td><span className="wb-flow-type expense">{groupOf(t.capability)}</span></td>
                            <td>{statusLabel(t.status)}</td>
                          </tr>
                        ))}
                        {stats.recentTasks.length === 0 && <tr><td colSpan={4} className="wb-table-empty">暂无记录</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}
        </article>

        <article className="wb-panel wb-recent">
          {!token ? (
            <div className="wb-login-prompt">
              <p>登录后保存和查看最近任务</p>
              <button type="button" onClick={openLogin}>登录查看</button>
            </div>
          ) : (
            <>
              <div className="wb-panel-title">
                <strong>最近任务</strong>
                <button type="button" onClick={() => navigate('/works')}>
                  全部作品 <ArrowRight size={12} />
                </button>
              </div>
              {loading ? (
                <StateSkeleton variant="row" count={3} />
              ) : error ? (
                <StateError title="加载失败" desc="没能取回最近任务列表。" detail={error} onRetry={load} compact />
              ) : stats && stats.recentTasks.length > 0 ? (
                <div className="wb-jobs-list">
                  {stats.recentTasks.slice(0, 4).map((t) => (
                    <button key={t.id} type="button" className="wb-job" onClick={() => navigate('/works')}>
                      <span className="wb-job-thumb">
                        {t.thumbnailUrl ? <img src={toAbsoluteUrl(t.thumbnailUrl)} alt="" loading="lazy" /> : <CapabilityIcon id={t.capability} size={18} />}
                      </span>
                      <span className="wb-job-copy">
                        <b>{t.name}</b>
                        <span>{t.createdAt ? new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</span>
                      </span>
                      <span className={`wb-job-status ${t.status === 'succeeded' ? 'completed' : t.status === 'failed' ? 'failed' : 'processing'}`}>{statusLabel(t.status)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="wb-jobs-empty">还没有生成记录，去工作台创建第一条</div>
              )}
            </>
          )}
        </article>
      </section>

      <section className="wb-panel wb-dashboard" aria-labelledby="wb-dashboard-title">
        {!token ? (
          <div className="wb-login-prompt">
            <p>登录后查看创作数据</p>
            <button type="button" onClick={openLogin}>登录查看</button>
          </div>
        ) : (
          <>
            <div className="wb-dashboard-head">
              <div>
                <strong id="wb-dashboard-title">数据看板</strong>
                <span>统计区间：近 7 天</span>
              </div>
            </div>
            {loading ? (
              <StateSkeleton variant="panel" count={4} />
            ) : error ? (
              <StateError title="数据加载失败" desc="没能取回创作数据。可能是后端未启动或网络异常，重试一次即可。" detail={error} onRetry={load} compact />
            ) : stats ? (
              <>
                <div className="wb-dashboard-stats">
                  {DASH_TILES.map((t) => (
                    <div key={t.label}>
                      <span>{t.label}</span>
                      <b>{t.value(stats)}</b>
                    </div>
                  ))}
                </div>
                <div className="wb-chart-title">每日产出（近 7 天）</div>
                <div className="wb-trend-chart">
                  {stats.last7Days.map((d) => (
                    <div key={d.date} className="wb-trend-col">
                      <span className="wb-trend-count">{d.count > 0 ? d.count : ''}</span>
                      <span className="wb-trend-bar-wrap">
                        <span className="wb-trend-bar" style={{ height: `${Math.round((d.count / max7d) * 100)}%` }} />
                      </span>
                      <span className="wb-trend-date">{d.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
