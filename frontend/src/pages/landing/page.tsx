import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

import type { MembershipPlan, Product, PromoCampaign } from '../../types/api';
import { membershipApi, myMarketingApi, productsApi } from './api';
import { LandingHeader } from './LandingHeader';
import {
  A,
  ADDON_ICONS,
  BIZ_CARDS,
  CASE_GROUPS,
  FLOW_STEPS,
  HERO_SHOTS,
  TOOL_ENTRIES,
} from './constants';
import { useCapabilities, useDocumentMeta } from './hooks';
import {
  capabilityName,
  caseTarget,
  formatCampaignEnd,
  isCapabilityVisible,
  PLAN_VISUALS,
  toolPath,
  uniqueCaseFiles,
} from './utils';

/**
 * 营销首页。
 *
 * 结构 (2026-10-31 改版, 类名前缀 `lp-`):
 *   1 首屏   左文案 + 双 CTA + 三条保障, 右 2x2 真实产出拼贴
 *   2 核心场景  商品主图 / 商品详情 / 爆款复刻 三张入口卡
 *   3 修图工具  8 个常用工具, 一屏内完成选择
 *   4 使用流程  上传 → 选能力 → 下载, 三步说明
 *   5 优秀案例  7 个分类平铺长式依次陈列, 每个分类 5 张, 不切页签
 *   6 套餐与积分 订阅 / 加油包 / 限时活动三个页签, 数据全部读接口
 *   7 产品特性  宽卡 + 两张补充卡
 *   8 底部行动区
 *
 * 与参考站的关系: 版面不再是逐像素复刻, 但商业内容 (套餐价目 / 案例图 / 客户 logo)
 * 仍来自 `frontend/public/landing/` 自托管资源; 价目、能力清单、活动一律读后端接口,
 * 页面不写死任何价格或能力数量。品牌标识保留本项目自有 (货觉AI)。
 */
export function LandingPage() {
  useDocumentMeta(
    '货觉AI · 电商视觉创作平台',
    '上传商品图，生成能上架的图。商品主图、详情页、营销视觉，一站生成。',
  );
  const navigate = useNavigate();
  const { data: capabilityData } = useCapabilities();
  const [pkgTab, setPkgTab] = useState<'sub' | 'addon' | 'campaign'>('sub');
  /**
   * 进行中的限时活动。页签**只在真有活动时出现** ——
   * 此前这里是写死的「双节上新」禁用页签，永远点不开也永远没有内容。
   */
  const [campaigns, setCampaigns] = useState<PromoCampaign[]>([]);
  /** 加油包: 读后端 SKU。拉不到时如实留空, 不回落硬编码价 */
  const [addons, setAddons] = useState<Product[]>([]);
  /** 订阅套餐: 读后端 MembershipPlan, 同样不回落硬编码 */
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  /**
   * 两个价目接口各自的加载/失败状态 (2026-10-20 修)。
   *
   * 此前失败与"加载中"共用 `length === 0` 一个判断, 失败后页面会**永久**
   * 显示「套餐加载中…」—— 接口早就挂了, 用户看到的却是一个永远转不完的等待。
   * 加载中 / 加载失败 / 没有该商品 三者必须分开。
   */
  const [plansState, setPlansState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [addonsState, setAddonsState] = useState<'loading' | 'error' | 'ready'>('loading');

  useEffect(() => {
    let alive = true;
    // 两个价目接口互不依赖, 一个失败不该拖垮另一个
    productsApi
      .list()
      .then((list) => {
        if (!alive) return;
        setAddons(list);
        setAddonsState('ready');
      })
      .catch(() => {
        // 拉不到就显示为空态 —— 落地页不该因为一个接口挂了就整页崩掉,
        // 也不该回落硬编码价 (那正是本次要消灭的第二套价目)
        if (!alive) return;
        setAddons([]);
        setAddonsState('error');
      });
    membershipApi
      .plans()
      .then((list) => {
        if (!alive) return;
        setPlans(list);
        setPlansState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setPlans([]);
        setPlansState('error');
      });
    // 限时活动: 失败就当没有活动（页签不出现），不弹错 —— 落地页不该为促销位报错
    myMarketingApi
      .campaigns()
      .then((list) => {
        if (alive) setCampaigns(list);
      })
      .catch(() => {
        if (alive) setCampaigns([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 首页入口同样跟随能力运行时状态。
   *
   * 能力清单未到达（或请求失败）时保留全部入口：首页是公开首屏，不能因为
   * 一次清单抖动就整块消失。清单到达后再把运营下线的能力隐藏。
   */
  const visibleCapabilityIds = useMemo(() => {
    if (!capabilityData) return null;
    return new Set(capabilityData.items.filter(isCapabilityVisible).map((c) => c.id));
  }, [capabilityData]);
  const bizCards = visibleCapabilityIds
    ? BIZ_CARDS.filter((b) => visibleCapabilityIds.has(b.capability))
    : BIZ_CARDS;
  const toolEntries = visibleCapabilityIds
    ? TOOL_ENTRIES.filter((t) => visibleCapabilityIds.has(t.capability))
    : TOOL_ENTRIES;
  /** 首屏文案里的能力数: 取运行时可见能力; 清单未到达时按 CAPABILITY_PLUGINS 声明数兜底 */
  const totalCapabilities = visibleCapabilityIds?.size ?? 17;

  // 案例分组与商品卡、工具入口同口径：运营下线的能力整组不再展示。
  const caseGroups = useMemo(
    () =>
      visibleCapabilityIds
        ? CASE_GROUPS.filter((g) => visibleCapabilityIds.has(g.capability))
        : CASE_GROUPS,
    [visibleCapabilityIds],
  );

  /** 能力清单已到达时，CTA 也必须跟随时运行时可见性，不能指向已下线工具 */
  const canUse = (capability: string) =>
    !visibleCapabilityIds || visibleCapabilityIds.has(capability);

  return (
    <div className="landing-page" data-route-stage>
      <LandingHeader />

      {/* ── 1. 首屏: 左文案 / 右真实产出拼贴 ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <Sparkles size={13} aria-hidden />
              货觉AI · {totalCapabilities} 项电商视觉能力
            </span>
            <h1>
              一张商品图
              <br />
              <em>出全套电商视觉</em>
            </h1>
            <p className="lp-hero-sub">
              白底主图、场景图、卖点图、详情长图与修图工具，全部在同一个工作台完成。
              真实模型生成，按能力计费。
            </p>
            <div className="lp-hero-actions">
              <button
                type="button"
                className="lp-btn lp-btn-primary"
                onClick={() => navigate(bizCards[0]?.to ?? '/workbench')}
              >
                免费开始创作
                <ArrowRight size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="lp-btn lp-btn-ghost"
                onClick={() => navigate('/packages')}
              >
                查看套餐价目
              </button>
            </div>
            <ul className="lp-hero-proof">
              <li>
                <Check size={14} aria-hidden />
                真实模型产出
              </li>
              <li>
                <Check size={14} aria-hidden />
                失败原额退还
              </li>
              <li>
                <Check size={14} aria-hidden />
                生成即入库
              </li>
            </ul>
          </div>
          <div className="lp-hero-visual" aria-hidden>
            {HERO_SHOTS.map((shot, i) => (
              <figure key={shot.src} className={`lp-hero-shot is-${i + 1}`}>
                <img
                  src={shot.src}
                  alt=""
                  width={600}
                  height={800}
                  loading={i < 2 ? 'eager' : 'lazy'}
                />
                <figcaption>{shot.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. 核心场景 ── */}
      <section className="lp-section">
        <header className="lp-section-head">
          <span className="lp-kicker">核心场景</span>
          <h2>从一张商品图，到一整套视觉</h2>
          <p>主图、详情、爆款复刻三条主线，覆盖上新与投放的主要构图需求。</p>
        </header>
        <div className="lp-scene-grid">
          {bizCards.map((b) => (
            <article key={b.title} className="lp-scene-card">
              <div className="lp-scene-media">
                <img src={b.img} alt="" width={1712} height={800} loading="lazy" />
              </div>
              <div className="lp-scene-body">
                <h3>
                  <img
                    className="lp-scene-icon"
                    src={`${A}/icons/${b.icon}.svg`}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                  />
                  {b.title}
                </h3>
                <p>{b.desc}</p>
                <button type="button" className="lp-scene-link" onClick={() => navigate(b.to)}>
                  开始生成
                  <ArrowRight size={14} aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 3. 修图工具 ── */}
      <section className="lp-section lp-section-tight">
        <div className="lp-tools-head">
          <div>
            <span className="lp-kicker">修图工具</span>
            <h2>日常修图，一个入口</h2>
          </div>
          <Link to="/workbench" className="lp-text-link">
            全部工具
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="lp-tool-grid">
          {toolEntries.map((t) => (
            <button key={t.label} type="button" className="lp-tool" onClick={() => navigate(t.to)}>
              <img src={`${A}/icons/${t.icon}.svg`} alt="" aria-hidden loading="lazy" decoding="async" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. 使用流程 ── */}
      <section className="lp-section lp-section-tight">
        <div className="lp-flow-panel">
          {FLOW_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="lp-step">
                <span className="lp-step-index">0{i + 1}</span>
                <div className="lp-step-copy">
                  <h3>
                    <Icon size={16} aria-hidden />
                    {step.title}
                  </h3>
                  <p>{step.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 5. 优秀案例: 7 个分类平铺长式, 不切页签 ── */}
      {caseGroups.length > 0 && (
        <section className="lp-section">
          <div className="lp-cases-head">
            <div>
              <span className="lp-kicker">优秀案例</span>
              <h2>看看工具能做出什么</h2>
            </div>
          </div>
          {/* 每个分类按商品去重后只陈列 5 张: 分类全部展开,
              访客不必猜「别的能力能不能做」—— 只是把库存图墙换成 7 段短条 */}
          <div className="lp-case-groups">
            {caseGroups.map((group) => {
              const target = caseTarget(group.key);
              return (
                <article className="lp-case-group" key={group.key}>
                  <header className="lp-case-group-head">
                    <h3>{group.label}</h3>
                    <button type="button" className="lp-text-link" onClick={() => navigate(target)}>
                      做同款
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  </header>
                  <div className="lp-case-strip">
                    {uniqueCaseFiles(group.files).slice(0, 5).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="lp-case-card"
                        aria-label={`${group.label}示例，做同款`}
                        onClick={() => navigate(target)}
                      >
                        {/* 按钮已有 aria-label, 图片作为卡面内容不再重复同一句 alt */}
                        <img
                          src={`${A}/case/${f}`}
                          alt=""
                          width={600}
                          height={800}
                          loading="lazy"
                        />
                        <span className="lp-case-label">做同款</span>
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 6. 套餐与积分 ── */}
      <section className="lp-section" id="packages">
        <div className="lp-packages-head">
          <div>
            <span className="lp-kicker">套餐与积分</span>
            <h2>按需订阅，或随时加油</h2>
            <p>订阅套餐每月发放积分；积分包一次购买，有效期以卡片标注为准。</p>
          </div>
          <Link to="/packages" className="lp-text-link">
            进入积分商城
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="lp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={pkgTab === 'sub'}
            className={pkgTab === 'sub' ? 'is-active' : ''}
            onClick={() => setPkgTab('sub')}
          >
            订阅套餐
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pkgTab === 'addon'}
            className={pkgTab === 'addon' ? 'is-active' : ''}
            onClick={() => setPkgTab('addon')}
          >
            加油包
          </button>
          {campaigns.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={pkgTab === 'campaign'}
              className={pkgTab === 'campaign' ? 'is-active' : ''}
              onClick={() => setPkgTab('campaign')}
            >
              限时活动
            </button>
          )}
        </div>
        <div className="lp-packages-body">
          {pkgTab === 'sub' ? (
            <div className="lp-plan-grid">
              {plansState === 'loading' && (
                <p className="lp-empty">套餐加载中…</p>
              )}
              {plansState === 'error' && (
                <p className="lp-empty">套餐暂时加载失败，请稍后刷新查看</p>
              )}
              {plansState === 'ready' && plans.filter((p) => p.durationDays > 0).length === 0 && (
                <p className="lp-empty">暂无可用套餐</p>
              )}
              {plans.filter((plan) => plan.durationDays > 0).map((plan, i) => {
                const visual = PLAN_VISUALS[i];
                return (
                  <article
                    key={plan.id}
                    className={`lp-plan-card${visual?.recommended ? ' is-recommended' : ''}`}
                  >
                    {visual?.tag && (
                      <span className={`lp-plan-tag${visual.recommended ? ' is-hot' : ''}`}>
                        {visual.tag}
                      </span>
                    )}
                    <h3>{plan.name}</h3>
                    <div className="lp-plan-price">
                      <span className="cur">¥</span>
                      <strong>{(plan.priceCents / 100).toFixed(2)}</strong>
                      <em>/ {plan.durationDays} 天</em>
                    </div>
                    <p className="lp-plan-credits">
                      {plan.monthlyCredits.toLocaleString('zh-CN')} 积分 / 月
                    </p>
                    {/* 权益文案由后端 buildPerkLabels 生成 —— 改权益只需改一处,
                        不会出现「宣传页写的和实际给的不一样」 */}
                    <ul className="lp-plan-perks">
                      {plan.perkLabels.map((f) => (
                        <li key={f}>
                          <Check size={13} aria-hidden />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {/*
                     * 订阅购买走订单+支付链路: MembershipPlan 不在 Product 表里,
                     * 下单时走 `membershipPlanId`, 与积分包同一条支付通道。
                     */}
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => navigate(`/checkout/membership?planId=${encodeURIComponent(plan.id)}`)}
                    >
                      立即订阅
                    </button>
                  </article>
                );
              })}
            </div>
          ) : pkgTab === 'addon' ? (
            <div className="lp-addon-grid">
              {addonsState === 'loading' && (
                <p className="lp-empty">积分包加载中…</p>
              )}
              {addonsState === 'error' && (
                <p className="lp-empty">积分包暂时加载失败，请稍后刷新查看</p>
              )}
              {addonsState === 'ready' && addons.length === 0 && (
                <p className="lp-empty">暂无可用积分包</p>
              )}
              {/*
               * 首页只陈列前 4 款 (一行), 全量 15 款在 `/packages` ——
               * 首页是入口不是价目表, 15 张卡会把落地页拉成第二个商城。
               */}
              {addons.slice(0, 4).map((p, i) => (
                <article key={p.id} className="lp-addon-card">
                  {ADDON_ICONS[i] && (
                    <img
                      className="lp-addon-icon"
                      src={`${A}/icons/${ADDON_ICONS[i]}.svg`}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <h3>{p.name}</h3>
                  <div className="lp-addon-price">
                    {p.isFree ? (
                      <strong>免费</strong>
                    ) : (
                      <>
                        <span className="cur">¥</span>
                        <strong>{(p.priceCents / 100).toFixed(2)}</strong>
                        {p.originalPriceCents && p.originalPriceCents > p.priceCents && (
                          <del>¥{(p.originalPriceCents / 100).toFixed(2)}</del>
                        )}
                      </>
                    )}
                  </div>
                  {/*可生成张数不写死「积分 ÷ 10」—— 实际每次扣多少以能力消耗价为准,
                      与生成页显示的同一个数, 免得两处算法漂移 */}
                  <p className="lp-addon-meta">
                    {p.credits.toLocaleString('zh-CN')} 积分 ·{' '}
                    {p.creditsValidDays > 0 ? `${p.creditsValidDays} 天内有效` : '永久有效'}
                  </p>
                  <button
                    type="button"
                    className="lp-plan-buy"
                    onClick={() => navigate('/packages')}
                  >
                    {p.isFree ? '免费领取' : '立即购买'}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            /*
             * 限时活动：全部来自后台「限时活动」配置（`GET /marketing/campaigns`）。
             * 过期 / 下架商品 / 活动价不低于原价的活动后端已过滤，这里不做二次判断 ——
             * 展示层再算一遍价格就会出现「页面写 9.9、结算收 19.9」。
             */
            <div className="lp-addon-grid">
              {campaigns.map((c) =>
                c.type === 'limited_price' && c.product && typeof c.priceCents === 'number' ? (
                  <article key={c.id} className="lp-addon-card is-campaign">
                    <span className="lp-campaign-tag">限时价</span>
                    <h3>{c.product.name}</h3>
                    <div className="lp-addon-price">
                      <span className="cur">¥</span>
                      <strong>{(c.priceCents / 100).toFixed(2)}</strong>
                      <del>¥{(c.product.priceCents / 100).toFixed(2)}</del>
                    </div>
                    <p className="lp-addon-meta">
                      {c.name} · {formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => navigate(`/checkout/${encodeURIComponent(c.product!.sku)}`)}
                    >
                      立即抢购
                    </button>
                  </article>
                ) : (
                  <article key={c.id} className="lp-addon-card is-campaign">
                    <span className="lp-campaign-tag">限时免费</span>
                    <h3>{c.name}</h3>
                    <div className="lp-addon-price">
                      <strong>{c.onlyNewUsers ? '新客' : '0'}</strong>
                      <span>{c.onlyNewUsers ? '专享' : '积分'}</span>
                    </div>
                    <p className="lp-addon-meta">
                      {(c.capabilityIds ?? []).map((id) => capabilityName(id)).join(' / ')}
                      <br />
                      {c.onlyNewUsers ? '仅限新用户，登录后按资格生效 · ' : ''}{formatCampaignEnd(c.endAt)}结束
                    </p>
                    <button
                      type="button"
                      className="lp-plan-buy"
                      onClick={() => {
                        const first = c.capabilityIds?.[0];
                        navigate(first ? toolPath(first) : '/workbench');
                      }}
                    >
                      去使用
                    </button>
                  </article>
                ),
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 7. 产品特性 ── */}
      <section className="lp-section">
        <header className="lp-section-head is-center">
          <span className="lp-kicker">产品特性</span>
          <h2>为电商而生的 AI 作图工作台</h2>
          <p>上传、生成、下载，全流程在同一个页面完成。</p>
        </header>
        <article className="lp-feature-wide">
          <div className="lp-feature-copy">
            <h3>一张商品图，搞定全套图</h3>
            <ul>
              <li>省下布景、拍摄、修图的重复成本</li>
              <li>一张图延展多套视觉，快速测试点击率</li>
              <li>风格统一，适合店铺、广告、详情页同步使用</li>
            </ul>
            {canUse('main_image') && (
              <button type="button" className="lp-btn lp-btn-primary" onClick={() => navigate('/product-kit')}>
                去试试
                <ArrowRight size={15} aria-hidden />
              </button>
            )}
          </div>
          <div className="lp-feature-media">
            {/* 参考站该区是 banner 背景图内嵌, 本项目改用真实产出拼贴(诚实替代)。
                网格为 4 列 2 行: 主图跨 2x2 占 4 格, 余 4 格各放一张 → 共 5 张, 不留空行 */}
            <img
              className="lp-feature-main"
              src={`${A}/feat/top_01.png`}
              alt=""
              width={1254}
              height={1254}
              loading="lazy"
            />
            <img src={`${A}/feat/left_01.png`} alt="" width={800} height={800} loading="lazy" />
            <img src={`${A}/feat/right_02.png`} alt="" width={800} height={800} loading="lazy" />
            <img src={`${A}/feat/top_02.png`} alt="" width={1254} height={1254} loading="lazy" />
            <img src={`${A}/feat/top_03.png`} alt="" width={1254} height={1254} loading="lazy" />
          </div>
        </article>
        <div className="lp-feature-grid">
          <article className="lp-feature-card">
            <h3>一键生成完整的电商详情图组</h3>
            <ul>
              <li>把参数和卖点转成可视化内容</li>
              <li>模块化输出，方便直接排版落地</li>
              <li>提升页面完整度，减少设计制作时间</li>
            </ul>
            {canUse('detail_image') && (
              <button type="button" className="lp-text-link" onClick={() => navigate('/product-detail')}>
                去试试
                <ArrowRight size={14} aria-hidden />
              </button>
            )}
          </article>
          <article className="lp-feature-card">
            <h3>复刻爆款图的设计风格</h3>
            <ul>
              <li>拆解爆款视觉逻辑，降低试错成本</li>
              <li>跟款上新更快，趋势不掉队</li>
              <li>保留原图氛围，替换主体不违和</li>
            </ul>
            {canUse('hot_remake') && (
              <button type="button" className="lp-text-link" onClick={() => navigate('/viral-clone')}>
                去试试
                <ArrowRight size={14} aria-hidden />
              </button>
            )}
          </article>
        </div>
      </section>

      {/* ── 8. 底部行动区 ── */}
      <section className="lp-cta">
        <div className="lp-cta-inner">
          <h2>现在开始，用一张图做完一套图</h2>
          <p>注册即用，按能力计费，生成失败原额退还。</p>
          <button
            type="button"
            className="lp-btn lp-btn-on-brand"
            onClick={() => navigate(bizCards[0]?.to ?? '/workbench')}
          >
            免费开始创作
            <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      </section>

      {/* ── 9. 页脚 ── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <strong>货觉AI · 电商视觉创作平台</strong>
            <p>好图，好卖 —— 商品图 · 详情页 · 营销视觉，一站生成</p>
            <div className="landing-footer-logos">
              <img src={`${A}/logos/t_y01.png`} alt="客户 logo" width={190} height={40} loading="lazy" />
              <img src={`${A}/logos/t_y02.png`} alt="客户 logo" width={160} height={38} loading="lazy" />
              <img src={`${A}/logos/t_y03.png`} alt="客户 logo" width={93} height={28} loading="lazy" />
            </div>
          </div>
          <div className="landing-footer-col">
            <h4>AI工具</h4>
            {canUse('main_image') && <Link to="/product-kit">商品主图</Link>}
            {canUse('hot_remake') && <Link to="/viral-clone">爆款复刻</Link>}
            <Link to="/workbench">更多工具</Link>
          </div>
          <div className="landing-footer-col">
            <h4>积分套餐</h4>
            <Link to="/packages">积分购买</Link>
            <Link to="/credits">积分明细</Link>
            <Link to="/works">任务记录</Link>
          </div>
          <div className="landing-footer-col">
            <h4>支持与服务</h4>
            <Link to="/tickets?type=consultation&compose=1">帮助中心</Link>
            <Link to="/tickets?type=complaint&compose=1">投诉举报</Link>
          </div>
        </div>
        <p className="landing-footer-copy">
          © 2026 货觉AI · 页面用于产品展示，案例素材版权归各自权利人所有。
        </p>
      </footer>
    </div>
  );
}
