import { ChevronLeft } from 'lucide-react';

import { sceneLabel } from './utils';

/**
 * 工作区顶栏 —— 流程第 2 步的头部（参考站 §4.1，无文字标题只有返回图标）。
 *
 * 标题取场景中文名；场景值未知时原样回显，不让标题空白。
 */
export function MultiFusionEditorHeader({
  scene,
  onBack,
}: {
  scene: string;
  onBack: () => void;
}) {
  return (
    <header className="multi-image-fusion-editor-head">
      <div className="multi-image-fusion-editor-title">
        {/* S-13/D-90: 参考站是 30x30 纯图标方块, 无文字 */}
        <button
          type="button"
          className="multi-image-fusion-scene-back"
          aria-label="返回场景列表"
          onClick={onBack}
        >
          <ChevronLeft size={16} />
        </button>
        <div>
          <h1>{sceneLabel(scene)}</h1>
          <p>上传主体图和搭配图，AI 将多张图片融合为一张新图</p>
        </div>
      </div>
    </header>
  );
}
