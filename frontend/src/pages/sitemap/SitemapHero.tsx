/** 页头：站点索引标题与说明。 */
export function SitemapHero() {
  return (
    <section className="pb-[34px]">
      <span className="block text-xs font-bold tracking-[1.4px] text-muted-foreground">
        HUOJUE AI / SITE INDEX
      </span>
      <h1 className="mt-3 text-[68px] font-[780] leading-[66.64px] text-foreground max-[900px]:text-[40px] max-[900px]:leading-[44px]">
        网站地图.
      </h1>
      <p className="mt-[18px] max-w-[720px] text-sm leading-[26px] text-[var(--text-body)]">
        这里汇总货觉AI当前网站的页面地址，按创作入口、AI 工具、账户内容和站点页面分组，
        方便快速找到需要的功能。
      </p>
    </section>
  );
}