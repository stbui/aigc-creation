import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui';

/**
 * 工具页右侧「功能示例 / 创作结果」页签外壳。
 *
 * 商品主图与商品详情右侧结构完全一致：胶囊页签 + 两个面板（示例 / 批次结果）。
 * 这里只负责页签、面板容器与角标；示例内容与结果列表由调用方以节点传入 ——
 * 两页的结果列表各自带业务语义（原图格标签、下载前缀），不在外壳里猜。
 *
 * 高度与 `.pk-workspace` 的行高锁定配合：Tabs 根节点吃掉剩余空间；未选中的面板
 * 由 radix 的 `hidden` 隐藏，只有 `data-state=active` 时才 `display:flex`，避免
 * 无条件 flex 覆盖 `[hidden]` 导致两面板同时可见。
 */

/** 右侧页签：功能示例 / 创作结果 */
export type OutputTab = 'demo' | 'results';

/** 胶囊页签按钮：压掉 shadcn Tabs 默认的下划线、圆角与高度 */
const TRIGGER = [
  'group/tab h-[30px] flex-none cursor-pointer gap-1.5 rounded-full border-0 px-4 py-0',
  'text-[13px] font-semibold text-muted-foreground hover:text-brand',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand focus-visible:ring-0',
  'data-[state=active]:bg-card! data-[state=active]:text-foreground',
  'data-[state=active]:shadow-[0_1px_3px_color-mix(in_srgb,var(--text-strong)_10%,transparent)]!',
  'after:hidden',
].join(' ');

export interface OutputTabsPaneProps {
  value: OutputTab;
  onChange: (tab: OutputTab) => void;
  /** 页签角标：按生成次数计，与下方批次行数一致 */
  generationCount: number;
  /** 功能示例面板 */
  demo: ReactNode;
  /** 创作结果面板 */
  results: ReactNode;
  /**
   * 示例面板页签名。工具页默认「功能示例」；写真模板页的示例区是模板灵感，
   * 故传「创作灵感」。结果页签名站内有统一口径，不开放覆盖。
   */
  demoLabel?: string;
  /** tablist 的可访问名称 */
  ariaLabel?: string;
}

export function OutputTabsPane({
  value,
  onChange,
  generationCount,
  demo,
  results,
  demoLabel = '功能示例',
  ariaLabel = '右侧面板',
}: OutputTabsPaneProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3 max-[1024px]:h-auto">
      <Tabs
        value={value}
        onValueChange={(next) => onChange(next as OutputTab)}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList
          variant="line"
          aria-label={ariaLabel}
          className="h-auto! gap-1 self-start rounded-full! border border-[var(--border-soft)] bg-muted p-1"
        >
          <TabsTrigger value="demo" className={TRIGGER}>
            {demoLabel}
          </TabsTrigger>
          <TabsTrigger value="results" className={TRIGGER}>
            创作结果
            {generationCount > 0 && (
              <span className="rounded-full bg-brand-bg px-1.5 text-xs leading-4 font-bold text-brand group-data-[state=active]/tab:bg-brand group-data-[state=active]/tab:text-card">
                {generationCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="demo" className="min-h-0 data-[state=active]:flex">
          <div
            data-slot="output-tab-panel"
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col max-[1024px]:h-auto"
          >
            {demo}
          </div>
        </TabsContent>
        <TabsContent value="results" className="min-h-0 data-[state=active]:flex">
          <div
            data-slot="output-tab-panel"
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col max-[1024px]:h-auto"
          >
            {results}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
