import { memo } from 'react';

import { ToolExampleCard, ToolExamplePanel, ToolExampleSource } from './components';

const FEATURES = '/landing/feat';

/** 三步流程: 固定文案, 与左侧表单的字段一一对应 */
const FLOW_STEPS = [
  { title: '上传商品与卖点', desc: '提供商品图、名称、描述与投放平台' },
  { title: 'AI 分析构图方向', desc: '理解主体、卖点与目标平台的主图规范' },
  { title: '批量生成整套主图', desc: '按白底、场景、卖点等类型一次出齐' },
];

/** 素材卡里的参数行: 与左侧「生成设置 / 商品描述 / 自定义配置」对应 */
const SOURCE_FACTS = [
  { label: '市场配置', value: '平台 淘宝 · 比例 1:1 · 画质 1K' },
  { label: '核心卖点', value: '美白祛斑，山茶花 + 人参精华，30ml 便携装' },
  { label: '套图配置', value: '卖点图 3 张 / 其他图 1 张' },
];

/**
 * 与输入同款的整套主图: 全部是商品主图产出。
 *
 * 不取商品详情页的模块长图 —— 详情图带长文排版, 放在主图页会让访客误判
 * 本能力也产详情页。素材取自官方「商品主图示例」, 与左侧原图同一商品。
 */
const SUITE_IMAGES = [
  { file: 'main_02.png', alt: '卖点图：美白祛斑与核心成分' },
  { file: 'main_03.png', alt: '卖点图：以油养肤与植萃配方' },
  { file: 'main_04.png', alt: '卖点图：透亮效果与数据背书' },
  { file: 'main_05.png', alt: '其他图：产品细节与滴管设计' },
];

/**
 * 商品主图页右侧「功能示例」面板。
 *
 * 首访时结果区为空, 用一组真实素材说明「商品图 + 卖点 → 整套主图」的链路。
 * 输入与输出示例均取自 public/landing, 不画示意图, 也不读取用户数据。
 */
function ProductKitExamplePanelImpl() {
  return (
    <ToolExamplePanel
      title="从一张商品图，到整套电商主图"
      description="上传商品素材与卖点，AI 按平台规范规划构图，一次生成一整套商品主图。"
      steps={FLOW_STEPS}
      note="示例素材用于展示流程，实际出图以模型输出为准。"
    >
      <ToolExampleCard step={1} title="商家产品素材 & 参数" tag="素材输入">
        <ToolExampleSource
          src={`${FEATURES}/main_01.png`}
          alt="示例商品图：美白祛斑代谢滴管精华液白底图"
          caption="产品原图"
          facts={SOURCE_FACTS}
        />
      </ToolExampleCard>

      <ToolExampleCard step={2} title="整套商品主图示例" tag="批量套图">
        <div className="pd-demo-slices pd-demo-slices--suite">
          {SUITE_IMAGES.map((image) => (
            <img
              key={image.file}
              src={`${FEATURES}/${image.file}`}
              alt={`示例产出：${image.alt}`}
              loading="lazy"
            />
          ))}
        </div>
      </ToolExampleCard>
    </ToolExamplePanel>
  );
}

export const ProductKitExamplePanel = memo(ProductKitExamplePanelImpl);
