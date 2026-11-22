import { Sparkles } from 'lucide-react';

import { SCENE_GROUPS } from './constants';
import { sceneImage } from './utils';
import { Button } from './components';

/**
 * 场景网关 —— 流程第 1 步（参考站 §2，两步流且无路由变化）。
 *
 * 选完场景直接进工作区，所以本组件只负责「列出场景 + 回调选择」，
 * 不持有任何状态；被选中的场景由页面持有。
 *
 * 场景卡是 shadcn `Button`（`variant="outline"`）纵排内容：显示 hover 抬升
 * 与 focus 环由按钮变体自身承担，不再手写 `scene-card` 的边框 / 阴影 / 动效。
 */
export function MultiFusionSceneGateway({ onSelect }: { onSelect: (scene: string) => void }) {
  return (
    <>
      {SCENE_GROUPS.map((group) => (
        <section key={group.name} className="mb-5.5 last:mb-0">
          <h2 className="mb-2.5 ml-0.5 text-sm leading-5 font-bold text-foreground">
            {group.name}
          </h2>
          <div className="grid grid-cols-6 gap-3 max-[1200px]:grid-cols-5 max-[900px]:grid-cols-3 max-[640px]:grid-cols-2">
            {group.scenes.map((scene) => (
              <Button
                key={scene.value}
                type="button"
                variant="outline"
                className="group flex h-auto min-w-0 flex-col justify-start gap-0 overflow-hidden rounded-[14px] border-border p-[11px] text-left shadow-card hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md focus-visible:-translate-y-0.5 focus-visible:border-brand focus-visible:ring-brand/30"
                onClick={() => onSelect(scene.value)}
              >
                {/* 15 个场景各配一张 2:1 预览图；图标留在图片下层，加载失败时自然兜底 */}
                <span
                  className="relative flex w-full min-h-[86px] items-center justify-center overflow-hidden rounded-[9px] bg-muted text-foreground max-[900px]:min-h-18"
                  aria-hidden
                >
                  <Sparkles className="size-5" />
                  <img
                    src={sceneImage(scene.value)}
                    alt=""
                    width={640}
                    height={320}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 block size-full object-contain transition-transform duration-[240ms] group-hover:scale-105"
                  />
                </span>
                <span className="grid w-full gap-0.75 px-0.5 pt-2.25 whitespace-normal">
                  <strong className="truncate text-xs leading-4.5 font-bold text-foreground">
                    {scene.label}
                  </strong>
                  <small className="line-clamp-2 min-h-4.25 overflow-hidden text-xs leading-4.25 font-normal text-muted-foreground">
                    {scene.desc}
                  </small>
                </span>
              </Button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
