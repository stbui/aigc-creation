import '../styles/product-detail-kit.css';

import type { ReactNode } from 'react';

import { Tabs } from '../ui';

/**
 * 工具页右侧「功能示例 / 创作结果」页签外壳。
 *
 * 商品主图与商品详情右侧结构完全一致：胶囊页签 + 两个面板（示例 / 批次结果）。
 * 这里只负责页签、面板容器与角标；示例内容与结果列表由调用方以节点传入 ——
 * 两页的结果列表各自带业务语义（原图格标签、下载前缀），不在外壳里猜。
 *
 * 高度与 `.pk-workspace` 的行高锁定配合：`.pd-right-tabs` 吃掉剩余空间，
 * 未选中的面板由 radix 的 `hidden` 隐藏（样式见 `styles/product-detail-kit.css`）。
 */

/** 右侧页签：功能示例 / 创作结果 */
export type OutputTab = 'demo' | 'results';

export interface OutputTabsPaneProps {
  value: OutputTab;
  onChange: (tab: OutputTab) => void;
  /** 页签角标：按生成次数计，与下方批次行数一致 */
  generationCount: number;
  /** 功能示例面板 */
  demo: ReactNode;
  /** 创作结果面板 */
  results: ReactNode;
  /** tablist 的可访问名称 */
  ariaLabel?: string;
}

export function OutputTabsPane({
  value,
  onChange,
  generationCount,
  demo,
  results,
  ariaLabel = '右侧面板',
}: OutputTabsPaneProps) {
  return (
    <section className="pd-right-pane">
      <Tabs
        activeKey={value}
        onChange={(key) => onChange(key as OutputTab)}
        className="pd-right-tabs"
        tabBarClassName="pd-tabs u-p-4"
        tabBarAriaLabel={ariaLabel}
        items={[
          {
            key: 'demo',
            label: '功能示例',
            children: <div className="pd-right-panel">{demo}</div>,
          },
          {
            key: 'results',
            label: (
              <>
                创作结果
                {generationCount > 0 && <span className="pd-tab-count u-font-12">{generationCount}</span>}
              </>
            ),
            children: <div className="pd-right-panel">{results}</div>,
          },
        ]}
      />
    </section>
  );
}
