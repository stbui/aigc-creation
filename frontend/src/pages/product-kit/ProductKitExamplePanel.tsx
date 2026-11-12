import { memo } from 'react';

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
  { label: '核心卖点', value: '弧形轻奢沙发，绒感科技布，高回弹海绵坐垫' },
  { label: '套图配置', value: '场景图 2 张 / 卖点图 2 张 / 其他图 1 张' },
];

/** 与输入沙发同款的整套主图: 场景、氛围、卖点与规格图 */
const SUITE_IMAGES = [
  { file: 'top_02.png', alt: '沙发场景图：轻奢客厅摆放效果' },
  { file: 'top_03.png', alt: '沙发氛围图：松弛感客厅主视觉' },
  { file: 'top_04.png', alt: '沙发卖点图：流线美学与弧形靠背' },
  { file: 'top_05.png', alt: '沙发卖点图：绒感面料与高回弹海绵' },
  { file: 'top_06.png', alt: '沙发规格图：尺寸与材质参数' },
];

/**
 * 商品主图页右侧「功能示例」面板。
 *
 * 首访时结果区为空, 用一组真实素材说明「商品图 + 卖点 → 整套主图」的链路。
 * 输入与输出示例均取自 public/landing, 不画示意图, 也不读取用户数据。
 * 内容全为常量, 用 memo 隔离左栏表单的按键重渲染。
 */
function ProductKitExamplePanelImpl() {
  return (
    <div className="pd-demo">
      <header className="pd-demo-intro">
        <h3>从一张商品图，到整套电商主图</h3>
        <p>上传商品素材与卖点，AI 按平台规范规划构图，一次生成白底、场景和卖点套图。</p>
        <ol className="pd-demo-steps">
          {FLOW_STEPS.map((step, i) => (
            <li key={step.title} className="pd-demo-step">
              <span className="pd-demo-step-no">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.desc}</small>
              </div>
            </li>
          ))}
        </ol>
      </header>

      <div className="pd-demo-cards">
        <article className="pd-demo-card">
          <header className="pd-demo-card-head">
            <h4>
              <i className="pd-demo-dot" aria-hidden />
              1. 商家产品素材 &amp; 参数
            </h4>
            <span className="pd-demo-tag">素材输入</span>
          </header>
          <div className="pd-demo-source">
            <figure className="pd-demo-shot">
              <img src={`${FEATURES}/top_01.png`} alt="示例商品图：弧形轻奢沙发白底图" loading="lazy" />
              <figcaption>产品原图</figcaption>
            </figure>
            <ul className="pd-demo-facts">
              {SOURCE_FACTS.map((fact) => (
                <li key={fact.label}>
                  <strong>{fact.label}：</strong>
                  {fact.value}
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="pd-demo-card">
          <header className="pd-demo-card-head">
            <h4>
              <i className="pd-demo-dot" aria-hidden />
              2. 整套商品主图示例
            </h4>
            <span className="pd-demo-tag">批量套图</span>
          </header>
          <div className="pd-demo-slices">
            {SUITE_IMAGES.map((image) => (
              <img
                key={image.file}
                src={`${FEATURES}/${image.file}`}
                alt={`示例产出：${image.alt}`}
                loading="lazy"
              />
            ))}
          </div>
        </article>
      </div>

      <p className="pd-demo-note">示例素材用于展示流程，实际出图以模型输出为准。</p>
    </div>
  );
}

export const ProductKitExamplePanel = memo(ProductKitExamplePanelImpl);
