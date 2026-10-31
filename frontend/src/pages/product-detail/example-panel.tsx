import { memo } from 'react';

const A = '/landing/feat';

/** 三步流程: 固定文案, 与左侧表单的字段一一对应 */
const FLOW_STEPS = [
  { title: '上传素材与商品信息', desc: '提供商品图、核心卖点与补充参数' },
  { title: 'AI 智能策划与构图', desc: '分析买家需求，匹配版块与出图方向' },
  { title: '一键生成详情长图', desc: '按模块分区排版，输出纵向长图' },
];

/**
 * 详情页版块 —— 与左侧「包含模块」一一对应。
 *
 * 本能力产出的是**一张**按模块分区排版的纵向长图, 不是多张单图再拼接,
 * 所以这里展示的是长图里的版块, 文案不写「切图 / 拼接」。
 * 全部取自 public/landing/feat 下同一套沙发详情页真实产出。
 */
const SECTIONS = [
  { file: 'top_02.png', alt: '示例版块：首屏主视觉' },
  { file: 'top_03.png', alt: '示例版块：使用场景' },
  { file: 'top_04.png', alt: '示例版块：设计细节' },
  { file: 'top_05.png', alt: '示例版块：舒适卖点' },
  { file: 'top_06.png', alt: '示例版块：规格参数' },
];

/** 素材卡里的参数行: 与左侧「生成设置 / 商品描述 / 包含模块」三块对应 */
const SOURCE_FACTS = [
  { label: '市场配置', value: '平台 淘宝 · 语言 简体中文' },
  { label: '核心卖点', value: '弧形轻奢沙发，绒感科技布，高回弹海绵坐垫' },
  { label: '包含模块', value: '首屏主视觉 / 使用场景 / 商品细节 / 规格参数' },
];

/**
 * 商品详情页右侧「功能示例」面板。
 *
 * 本页右侧在首访时是一块空白的结果区, 访客看不到这个能力到底产出什么。
 * 这里用真实产出讲清「素材 + 参数 → 分区详情长图」的链路, 内容全部取自
 * public/landing/feat 的同一套沙发详情页, 不画示意图、不编造效果。
 *
 * 纯展示组件: 不读接口、不接受业务数据 —— 示例与用户数据必须分开,
 * 否则「示例」会被误认为自己的历史作品。内容全为常量, 用 memo 隔离
 * 左栏表单的按键重渲染。
 */
function DetailExamplePanelBase() {
  return (
    <div className="pd-demo">
      <header className="pd-demo-intro">
        <h3>从一张商品图，到一整套详情页</h3>
        <p>上传素材与卖点，AI 策划版块与排版，直接输出一张可上架的详情长图。</p>
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
              <img src={`${A}/top_01.png`} alt="示例商品图：弧形轻奢沙发白底图" loading="lazy" />
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
              2. 详情页版块示例
            </h4>
            <span className="pd-demo-tag">分区排版</span>
          </header>
          <div className="pd-demo-slices">
            {SECTIONS.map((section) => (
              <img key={section.file} src={`${A}/${section.file}`} alt={section.alt} loading="lazy" />
            ))}
          </div>
        </article>
      </div>

      <p className="pd-demo-note">示例素材用于展示流程，实际出图以模型输出为准。</p>
    </div>
  );
}

export const DetailExamplePanel = memo(DetailExamplePanelBase);
