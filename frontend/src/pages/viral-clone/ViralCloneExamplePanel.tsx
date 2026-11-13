import { memo } from 'react';

import { ToolExampleCard, ToolExampleFactList, ToolExamplePanel } from './components';

const CASES = '/landing/case';

/** 三步流程: 与左侧表单一一对应, 不写成本页做不到的动作 */
const FLOW_STEPS = [
  { title: '上传商品图与参考图', desc: '商品图提供主体，参考图提供要复刻的构图与氛围' },
  { title: '选择复刻程度', desc: '高度复刻锁定构图，参考风格允许调整背景与道具' },
  { title: '对照生成结果', desc: '每次生成保留一组「商品图 → 参考图 → 生成图」对照' },
];

/**
 * 真实复刻产出: 每张都是「商品图 + 参考图 → 复刻结果」的完整案例。
 * 取自 public/landing/case 的同一套案例库, 不另外做示意图。
 */
const CASE_SHOTS = [
  { file: 'bkfk_01.png', alt: '复刻案例：运动鞋商品图与球场参考图合成场景主图' },
  { file: 'bkfk_02.png', alt: '复刻案例：桌面风扇商品图与桌面参考图合成生活场景图' },
  { file: 'bkfk_05.png', alt: '复刻案例：面霜商品图与岩石参考图合成氛围主图' },
  { file: 'bkfk_07.png', alt: '复刻案例：电动牙刷商品图与水花参考图合成视觉主图' },
];

/** 两档复刻程度的口径, 与左侧 ViralCloneDegreeCard 的说明一致 */
const DEGREE_FACTS = [
  {
    label: '高度复刻',
    value: '锁定参考图的构图与场景，替换为你的商品，并保证商品不变形。适合直接沿用爆款版式。',
  },
  {
    label: '参考风格',
    value: '提取参考图的构图、配色与光影，允许调整背景和道具。适合换场景但不丢风格。',
  },
];

/**
 * 爆款复刻页右侧「功能示例」面板。
 *
 * 首访时结果区是空的, 访客看不到这个能力到底产出什么。这里用真实复刻案例
 * 讲清「商品图 + 参考图 → 复刻结果」的链路, 并说明两档复刻程度的差异。
 *
 * 纯展示组件: 不读接口、不接受业务数据 —— 示例与用户数据必须分开,
 * 否则「示例」会被误认为自己的历史作品。
 */
function ViralCloneExamplePanelBase() {
  return (
    <ToolExamplePanel
      title="复刻爆款构图，换成你的商品"
      description="上传商品图与参考图，选择复刻程度，由真实图像模型按参考图的构图与氛围重新生成。"
      steps={FLOW_STEPS}
      note="示例均为真实复刻产出，实际出图以模型输出为准。"
    >
      <ToolExampleCard step={1} title="复刻案例" tag="真实产出">
        <div className="vc-demo-cases">
          {CASE_SHOTS.map((shot) => (
            <img key={shot.file} src={`${CASES}/${shot.file}`} alt={shot.alt} loading="lazy" />
          ))}
        </div>
      </ToolExampleCard>

      <ToolExampleCard step={2} title="两档复刻程度" tag="按需选择">
        <ToolExampleFactList facts={DEGREE_FACTS} />
      </ToolExampleCard>
    </ToolExamplePanel>
  );
}

export const ViralCloneExamplePanel = memo(ViralCloneExamplePanelBase);
