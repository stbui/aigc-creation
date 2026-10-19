import { useEffect, useState } from 'react';
import { App } from 'antd';
import { Link2, Image as ImageIcon, Sparkles } from 'lucide-react';
import { statsApi } from '../lib/api';
import { useCapabilities } from '../hooks/useCapabilities';
import type { StatsOverview } from '../types/api';

/**
 * 邀请有奖 —— 复刻参考站 https://ijihua.cn/invitations 的**版面结构**。
 *
 * 参考站该页未登录即可完整渲染，实测结构（2026-10-17）:
 *   顶部沿用 workspace 外壳（顶导 + 侧栏），主体为四块:
 *   1) 主视觉「邀请好友立赚 100 积分」+ 说明 + 两个按钮（复制邀请链接 / 查看邀请海报）
 *   2) 邀请步骤 三步（分享邀请链接/海报 → 好友注册 → 奖励自动发放），每步带说明
 *   3) 规则说明
 *   4) 数据明细 4 个数字（今日新增（人）/ 累计收益（积分）/ 累计邀请（人）/ …）
 *
 * 诚实差异（本项目无积分与邀请奖励体系，不编造）:
 *   - 主视觉与步骤按真实能力改写为「邀请协作」语义：分享链接 → 好友访问 → 一起创作
 *   - 数字块改为**真实可查**的本地数据（累计作品 / 真实产出 / 工具能力 / 本地不限次），
 *     不展示参考站的「积分」口径
 *   - 「复制邀请链接」为真实功能（写入剪贴板本站地址）；「查看邀请海报」如实提示未实现
 */

export function InvitationsPage() {
  const { message } = App.useApp();
  const { data } = useCapabilities();
  const [stats, setStats] = useState<StatsOverview | null>(null);

  useEffect(() => {
    statsApi
      .overview()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const copyLink = async () => {
    const url = `${window.location.origin}/`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('邀请链接已复制到剪贴板');
    } catch {
      message.info(`复制失败，请手动复制：${url}`);
    }
  };

  const last7 = stats?.last7Days ?? [];
  const todayCount = last7.length > 0 ? last7[last7.length - 1].count : 0;
  const realCount = stats?.totals.generated ?? 0;
  const capabilityCount = data?.items.length ?? 0;

  const steps = [
    { title: '分享邀请链接', desc: '复制链接发送给好友或社群，落地即本站营销首页' },
    { title: '好友访问', desc: '好友打开链接即可进入工作台，注册后可创建自己的项目' },
    { title: '一起创作', desc: '本地算法不限次数，好友各自的作品与素材互不影响' },
  ];

  const metrics = [
    { label: '今日产出（张）', value: todayCount },
    { label: '累计作品（张）', value: stats?.totals.tasks ?? 0 },
    { label: '真实产出图', value: realCount },
    { label: '工具能力（项）', value: capabilityCount },
  ];

  return (
    <div className="invite-page">
      <section className="invite-hero">
        <div className="invite-hero-copy">
          <h1>邀请好友一起用电商视觉工坊</h1>
          <p>
            分享本站链接，好友可直接进入工作台开始创作。本项目为本地演示，所有能力不限次数，
            不设积分与付费门槛。
          </p>
          <div className="invite-hero-actions">
            <button type="button" className="invite-btn-primary" onClick={() => void copyLink()}>
              <Link2 size={15} /> 复制邀请链接
            </button>
            <button
              type="button"
              className="invite-btn-ghost"
              onClick={() => message.info('本地演示未实现邀请海报生成，可直接把站点地址发给好友')}
            >
              <ImageIcon size={15} /> 查看邀请海报
            </button>
          </div>
        </div>
      </section>

      <section className="invite-block">
        <h2>邀请步骤</h2>
        <ol className="invite-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="invite-step">
              <span className="invite-step-no">{i + 1}</span>
              <span className="invite-step-title">{s.title}</span>
              <span className="invite-step-desc">{s.desc}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="invite-block">
        <h2>规则说明</h2>
        <ul className="invite-rules">
          <li>邀请链接指向本站营销首页，好友无需邀请码即可注册并创建项目。</li>
          <li>好友的作品、素材与任务记录仅本人可见，项目之间互相隔离。</li>
          <li>本地演示环境不提供积分奖励、现金或实物返还，相关能力未接入。</li>
          <li>如需对接真实模型与计费，可在后端 providers 模块替换实现，前端契约不变。</li>
        </ul>
      </section>

      <section className="invite-block">
        <h2>数据明细</h2>
        <div className="invite-metrics">
          {metrics.map((m) => (
            <div key={m.label} className="invite-metric">
              <span className="invite-metric-label">
                <Sparkles size={13} /> {m.label}
              </span>
              <span className="invite-metric-value">{m.value}</span>
            </div>
          ))}
        </div>
        <p className="invite-metrics-note">
          以上为当前账号在本站的真实数据，来自 <code>GET /api/v1/stats/overview</code> 与能力清单接口。
        </p>
      </section>
    </div>
  );
}
