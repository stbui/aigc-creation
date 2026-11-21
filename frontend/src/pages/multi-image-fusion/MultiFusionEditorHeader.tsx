import { ChevronLeft } from 'lucide-react';

import { sceneLabel } from './utils';
import { Button } from './components';

/**
 * 工作区顶栏 —— 流程第 2 步的头部（参考站 §4.1，无文字标题只有返回图标）。
 *
 * 标题取场景中文名；场景值未知时原样回显，不让标题空白。
 * 返回键是 shadcn `Button`（`variant="outline" size="icon-sm"`），30x30 方块，
 * 无障碍名「返回场景列表」。
 */
export function MultiFusionEditorHeader({ scene, onBack }: { scene: string; onBack: () => void }) {
  return (
    <header className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 max-[900px]:h-auto max-[900px]:items-start">
      <div className="flex min-w-0 items-center gap-2.25">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7.5 shrink-0"
          aria-label="返回场景列表"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="min-w-0">
          <h1 className="m-0 truncate text-lg leading-6 font-bold tracking-[-0.02em] text-foreground">
            {sceneLabel(scene)}
          </h1>
          <p className="mt-0.25 truncate text-xs leading-4.5 text-muted-foreground">
            上传主体图和搭配图，AI 将多张图片融合为一张新图
          </p>
        </div>
      </div>
    </header>
  );
}
