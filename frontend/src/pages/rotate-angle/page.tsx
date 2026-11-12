import { useState } from 'react';

import { DEFAULT_PITCH, DEFAULT_YAW, DEFAULT_ZOOM, type RotateTab } from './constants';
import {
  ToolHistoryPane,
  ToolShell,
  productSourcePane,
  productSourceUploadPreview,
} from './components';
import { useToolTask } from './hooks';
import { resultTagOf, rotatePayload } from './utils';
import { RotateAngleSettingsCard } from './RotateAngleSettingsCard';
import { useApp } from '../../ui';

/**
 * 旋转角度 —— 1:1 复刻参考站 https://ijihua.cn/rotate-angle。
 *
 * 实拍结构 (rotate-angle-page):
 *   上传卡: * 上传图片 (提示语 "支持 JPG、PNG、WebP，最多 1 张")
 *   旋转角度卡 (rotate-angle-settings):
 *     卡头: h2 + 重置参数按钮 (rotate-ccw 16px)
 *     tabs (role=tablist): 主体(默认) / 摄像头
 *       主体tab: rotate-angle-subject-stage > CSS 3D 立方体 (前/后/左/右/上/下 六面),
 *                transform: rotateX(pitch) rotateY(yaw), 可拖拽 (参考站 preview-drag)
 *       摄像头tab: rotate-angle-camera-stage > 轨道线 (12 条 15° 间隔) + 指针 +
 *                4 个方向键 (‹ › ⌃ ⌄, 分别调 yaw/pitch)
 *     三滑杆: 旋转 yaw -90..90 (默认0) / 倾斜 pitch -30..60 (默认0) /
 *            缩放 zoom 0.8..1.2 step0.01 (默认1, 标签显示"特写")
 *     提示: 相机保持静止，生成时按主体旋转角度重建商品展示。
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即生成 (消耗价由后端下发); 提示行 "确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 视角平滑旋转，细节立体呈现
 *
 * 诚实披露: rotate 为 real 能力 —— yaw 平面旋转 + pitch 逐行剪切 + zoom 缩放的
 * 2D 近似 (真实 3D 重建需 AI 模型, 页面与结果图均有标注)。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：设置卡 `RotateAngleSettingsCard`
 * 内含模式页签 `RotateAngleModeTabs`、可拖拽预览 `RotateAnglePreview`
 * （主体舞台 `RotateAngleSubjectStage` / 摄像头舞台 `RotateAngleCameraStage`）；
 * 角度状态与提交仍只留在本文件。
 */
export function RotateAnglePage() {
  const { message } = useApp();
  const { submitting, result, setResult, run } = useToolTask({
    capability: 'rotate',
    successMessage: '旋转结果已生成',
  });

  const [tab, setTab] = useState<RotateTab>('subject');
  const [yaw, setYaw] = useState(DEFAULT_YAW);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [sourceUrl, setSourceUrl] = useState('');

  const handleHistoryReuse = () => {
    setSourceUrl('');
    setResult(null);
  };

  const resetAngles = () => {
    setYaw(DEFAULT_YAW);
    setPitch(DEFAULT_PITCH);
    setZoom(DEFAULT_ZOOM);
    message.info('已重置旋转参数');
  };

  return (
    <ToolShell
      capability="rotate"
      pageClass="product-retouch-page rotate-angle-page rotate-angle-grid"
      inputPaneClassName="rotate-angle-controls"
      uploadActionsPlacement="above"
      title="旋转角度"
      desc="视角平滑旋转，细节立体呈现"
      upload={{ title: '上传图片', required: true, max: 1, hint: '支持 JPG、PNG、WebP，最多 1 张' }}
      replaceUpload
      renderUploadPreview={productSourceUploadPreview('待生成商品图')}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即生成"
      emptyVideo="/static/mp4/07_xzjd.mp4"
      emptyDesc="上传图片并调整角度后，结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={resultTagOf(yaw, pitch, zoom)}
      resultCompare={
        result?.status === 'succeeded' && result.url && sourceUrl
          ? { beforeUrl: sourceUrl, beforeLabel: '原图', afterLabel: '旋转后' }
          : undefined
      }
      onSubmit={(inputs, settings) => {
        setSourceUrl(inputs[0]?.url ?? '');
        return run(inputs, rotatePayload(tab, yaw, pitch, zoom, settings));
      }}
      sourcePane={productSourcePane('待生成商品图', 'rotate-angle-result')}
      onHistoryReuse={handleHistoryReuse}
      trailingPane={
        <ToolHistoryPane capability="rotate" refreshKey={result?.url} emptyText="暂无旋转记录" />
      }
    >
      {(images) => (
        <RotateAngleSettingsCard
          tab={tab}
          onTabChange={setTab}
          yaw={yaw}
          pitch={pitch}
          zoom={zoom}
          previewImage={images[0]?.url ?? null}
          onYawChange={setYaw}
          onPitchChange={setPitch}
          onZoomChange={setZoom}
          onReset={resetAngles}
        />
      )}
    </ToolShell>
  );
}
