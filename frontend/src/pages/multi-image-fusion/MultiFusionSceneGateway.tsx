import { Sparkles } from 'lucide-react';

import { SCENE_GROUPS } from './constants';
import { sceneImage } from './utils';

/**
 * 场景网关 —— 流程第 1 步（参考站 §2，两步流且无路由变化）。
 *
 * 选完场景直接进工作区，所以本组件只负责「列出场景 + 回调选择」，
 * 不持有任何状态；被选中的场景由页面持有。
 */
export function MultiFusionSceneGateway({ onSelect }: { onSelect: (scene: string) => void }) {
  return (
    <div className="multi-image-fusion-page is-scene-selection">
      <section className="multi-image-fusion-scene-selection">
        {SCENE_GROUPS.map((g) => (
          <section key={g.name} className="multi-image-fusion-scene-group">
            <h2>{g.name}</h2>
            <div className="multi-image-fusion-scene-grid">
              {g.scenes.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="multi-image-fusion-scene-card"
                  onClick={() => onSelect(s.value)}
                >
                  {/* 15 个场景各配一张 2:1 预览图；图标留在图片下层，加载失败时自然兜底 */}
                  <span className="multi-image-fusion-scene-visual" aria-hidden>
                    <Sparkles size={20} />
                    <img
                      src={sceneImage(s.value)}
                      alt=""
                      width={640}
                      height={320}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                  <span className="multi-image-fusion-scene-copy">
                    <strong>{s.label}</strong>
                    <small>{s.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
