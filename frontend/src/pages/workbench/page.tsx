import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CapabilityGroup, StatsOverview } from '../../types/api';
import { statsApi } from './api';
import { capabilityById, isCapabilityVisible } from './utils';
import { useAuth, useCredits } from './hooks';
import { WorkbenchToolGrid } from './WorkbenchToolGrid';
import { WorkbenchAccountPanel } from './WorkbenchAccountPanel';
import { WorkbenchRecentPanel } from './WorkbenchRecentPanel';
import { WorkbenchDashboard } from './WorkbenchDashboard';

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
 *
 * 分层（见 `docs/frontend-module-conventions.md`）:
 * 取数与登录态留在本文件，工具网格 / 账号面板 / 最近任务 / 数据看板各自成组件，
 * 常量、接口、hook、纯函数分别走 `constants` / `api` / `hooks` / `utils`。
 */
export function WorkbenchPage({
  workbenchIds,
  groups,
}: {
  workbenchIds: string[];
  groups: CapabilityGroup[];
}) {
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

  return (
    <div className="workbench-content">
      <section className="wb-workflow-banner" aria-label="工作台引导">
        <div>
          <h1>把电商运营，组织成一条工作流</h1>
          <p>继续你的商品内容创作，查看账号状态、任务进度和创作数据。</p>
        </div>
      </section>

      <WorkbenchToolGrid cards={cards} />

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
        <WorkbenchAccountPanel
          token={token}
          email={email}
          loading={loading}
          error={error}
          stats={stats}
          balance={balance}
          groups={groups}
          onRetry={load}
          onOpenLogin={openLogin}
        />
        <WorkbenchRecentPanel
          token={token}
          loading={loading}
          error={error}
          stats={stats}
          onRetry={load}
          onOpenLogin={openLogin}
        />
      </section>

      <WorkbenchDashboard
        token={token}
        loading={loading}
        error={error}
        stats={stats}
        onRetry={load}
        onOpenLogin={openLogin}
      />
    </div>
  );
}
