import type { ReactNode } from 'react';

export interface ToolExampleStep {
  title: string;
  desc: string;
}

export interface ToolExampleFact {
  label: string;
  value: string;
}

/**
 * 工具页右侧「功能示例」的展示骨架 —— 商品主图 / 商品详情 / 爆款复刻共用。
 *
 * 只抽结构（页头 → 三步流程 → 两张卡 → 脚注），文案与素材仍由各页常量提供：
 * 示例必须与用户数据严格分开，内容差异不能靠共享组件猜。
 */
export function ToolExamplePanel({
  title,
  description,
  steps,
  children,
  note,
}: {
  title: string;
  description: string;
  steps: ToolExampleStep[];
  children: ReactNode;
  note: string;
}) {
  return (
    <div className="pd-demo">
      <header className="pd-demo-intro">
        <h3>{title}</h3>
        <p>{description}</p>
        <ol className="pd-demo-steps">
          {steps.map((step, index) => (
            <li key={step.title} className="pd-demo-step u-py-10 u-px-12">
              <span className="pd-demo-step-no u-font-12">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{step.title}</strong>
                <small className="u-font-12">{step.desc}</small>
              </div>
            </li>
          ))}
        </ol>
      </header>

      <div className="pd-demo-cards">{children}</div>

      <p className="pd-demo-note u-font-12">{note}</p>
    </div>
  );
}

/** 示例卡：编号 + 标题 + 右上角口径标签 */
export function ToolExampleCard({
  step,
  title,
  tag,
  children,
}: {
  step: number;
  title: string;
  tag: string;
  children: ReactNode;
}) {
  return (
    <article className="pd-demo-card">
      <header className="pd-demo-card-head">
        <h4>
          <i className="pd-demo-dot" aria-hidden />
          {step}. {title}
        </h4>
        <span className="pd-demo-tag u-font-12">{tag}</span>
      </header>
      {children}
    </article>
  );
}

/** 素材输入卡：原图 + 参数行 */
export function ToolExampleSource({
  src,
  alt,
  caption,
  facts,
}: {
  src: string;
  alt: string;
  caption: string;
  facts: ToolExampleFact[];
}) {
  return (
    <div className="pd-demo-source">
      <figure className="pd-demo-shot">
        <img src={src} alt={alt} loading="lazy" />
        <figcaption className="u-py-2 u-px-8 u-font-12">{caption}</figcaption>
      </figure>
      <ToolExampleFactList facts={facts} />
    </div>
  );
}

export function ToolExampleFactList({ facts }: { facts: ToolExampleFact[] }) {
  return (
    <ul className="pd-demo-facts">
      {facts.map((fact) => (
        <li key={fact.label}>
          <strong>{fact.label}：</strong>
          {fact.value}
        </li>
      ))}
    </ul>
  );
}
