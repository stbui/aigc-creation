import { memo } from 'react';

import { ToolExampleCard, ToolExamplePanel, ToolExampleSource } from './components';

const A = '/landing/feat';

/** 三步流程: 固定文案, 与左侧表单的字段一一对应 */
const FLOW_STEPS = [
  { title: '上传素材与商品信息', desc: '提供商品图、核心卖点与补充参数' },
  { title: 'AI 智能策划与构图', desc: '分析买家需求，匹配版块与出图方向' },
  { title: '按模块生成详情图', desc: '每个模块单独出图，风格统一，可直接上架' },
];

/**
 * 详情模块 —— 与左侧「包含模块」一一对应。
 *
 * 本能力按勾选模块逐张出图, 一次提交得到一整套详情图,
 * 所以这里展示的是各模块的成品效果, 文案不写「长图 / 切图 / 拼接」。
 * 全部取自 public/landing/feat 下同一套沙发详情页真实产出。
 */
const SECTIONS = [
  { file: 'top_02.png', alt: '示例模块：首屏主视觉' },
  { file: 'top_03.png', alt: '示例模块：使用场景' },
  { file: 'top_04.png', alt: '示例模块：设计细节' },
  { file: 'top_05.png', alt: '示例模块：舒适卖点' },
  { file: 'top_06.png', alt: '示例模块：规格参数' },
];

/** 素材卡里的参数行: 与左侧「生成设置 / 商品描述 / 包含模块」三块对应 */
const SOURCE_FACTS = [
  { label: '平台与语言', value: '平台 淘宝 · 语言 简体中文' },
  { label: '核心卖点', value: '弧形轻奢沙发，绒感科技布，高回弹海绵坐垫' },
  { label: '包含模块', value: '首屏主视觉 / 使用场景 / 商品细节 / 规格参数' },
];

/**
 * 商品详情页右侧「功能示例」面板。
 *
 * 本页右侧在首访时是一块空白的结果区, 访客看不到这个能力到底产出什么。
 * 这里用真实产出讲清「素材 + 参数 → 一套按模块划分的详情图」的链路, 内容全部取自
 * public/landing/feat 的同一套沙发详情页, 不画示意图、不编造效果。
 *
 * 纯展示组件: 不读接口、不接受业务数据 —— 示例与用户数据必须分开,
 * 否则「示例」会被误认为自己的历史作品。
 */
function DetailExamplePanelBase() {
  return (
    <ToolExamplePanel
      title="从一张商品图，到一整套详情页"
      description="上传素材与卖点，AI 按模块策划画面，一次生成整套可直接上架的详情图。"
      steps={FLOW_STEPS}
      note="示例素材用于展示流程，实际出图以模型输出为准。"
    >
      <ToolExampleCard step={1} title="商家产品素材 & 参数" tag="素材输入">
        <ToolExampleSource
          src={`${A}/top_01.png`}
          alt="示例商品图：弧形轻奢沙发白底图"
          caption="产品原图"
          facts={SOURCE_FACTS}
        />
      </ToolExampleCard>

      <ToolExampleCard step={2} title="各模块成品示例" tag="按模块出图">
        <div className="pd-demo-slices">
          {SECTIONS.map((section) => (
            <img key={section.file} src={`${A}/${section.file}`} alt={section.alt} loading="lazy" />
          ))}
        </div>
      </ToolExampleCard>
    </ToolExamplePanel>
  );
}

export const DetailExamplePanel = memo(DetailExamplePanelBase);
