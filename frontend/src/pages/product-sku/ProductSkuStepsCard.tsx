import { SKU_STEPS } from './constants';
import { Badge, SectionCard } from './components';

/**
 * 未框选区域时的使用步骤卡；步骤文案集中在 `SKU_STEPS`。
 *
 * 序号用 shadcn `Badge`（圆形徽标），步骤列表是语义化的 `<ol>`：
 * 顺序本身是信息，读屏会播报条目序号。竖虚线只在相邻步骤之间出现
 * （最后一节的 `last:after:hidden` 去掉）。
 */
export function ProductSkuStepsCard() {
  return (
    <SectionCard title="使用步骤">
      <ol className="m-0 flex list-none flex-col gap-6 p-0 py-2">
        {SKU_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative z-[1] flex min-h-11 w-full items-center gap-4 pl-2 after:absolute after:top-10 after:left-5 after:h-8 after:border-l after:border-dashed after:border-border last:after:hidden"
          >
            <Badge className="size-6 shrink-0 basis-6 justify-center rounded-xl p-0 text-xs">
              {index + 1}
            </Badge>
            <div className="grid min-w-0 flex-1 gap-2">
              <strong className="text-sm leading-4 font-normal text-foreground">{step.title}</strong>
              <span className="text-xs leading-5 text-muted-foreground">{step.description}</span>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
