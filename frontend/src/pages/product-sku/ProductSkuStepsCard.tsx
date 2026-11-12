import { SKU_STEPS } from './constants';
import { Surface, SurfaceContent, SurfaceHeader, SurfaceTitle } from './components';

/** 未框选区域时的使用步骤卡；步骤文案集中在 `SKU_STEPS`。 */
export function ProductSkuStepsCard() {
  return (
    <Surface className="product-sku-card product-sku-steps-card gap-0 border-0 shadow-none">
      <SurfaceHeader className="mb-4 gap-0 px-0">
        <SurfaceTitle className="text-sm leading-5 font-bold">使用步骤</SurfaceTitle>
      </SurfaceHeader>
      <SurfaceContent className="px-0">
        <ol className="product-sku-steps">
          {SKU_STEPS.map((step, index) => (
            <li key={step.title} className="product-sku-step">
              <b>{index + 1}</b>
              <div>
                <strong>{step.title}</strong>
                <span>{step.description}</span>
              </div>
            </li>
          ))}
        </ol>
      </SurfaceContent>
    </Surface>
  );
}
