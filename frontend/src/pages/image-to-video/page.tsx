import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import type { ToolAsset } from './components';
import { ToolShell } from './components';
import { IMAGE_TO_VIDEO_CAPABILITY } from './constants';
import { useCapabilities, useToolTask } from './hooks';
import { VideoResultPane } from './VideoResultPane';
import { VideoSettingsCard } from './VideoSettingsCard';
import { VideoUploadPreview } from './VideoUploadPreview';
import {
  buildImageToVideoPayload,
  isVideoFormReady,
  videoParamDefaults,
  type VideoParamValues,
} from './utils';

/**
 * 通用视频创作页 —— 图生视频。
 *
 * 专用路由 `/tools/image_to_video` 保留完整工作台，即使当前没有模型线路也
 * 只禁用提交并说明原因，不再由通用 ToolPage 整页替换成「暂不可用」异常页。
 * 所有视频参数、默认值与模型价格均从后端清单读取。
 */
export function ImageToVideoPage() {
  const { data: capabilities, loading, error } = useCapabilities();
  const definition =
    capabilities?.items.find((item) => item.id === IMAGE_TO_VIDEO_CAPABILITY) ?? null;
  const params = definition?.params ?? [];

  const [values, setValues] = useState<VideoParamValues>({});
  const [submittedValues, setSubmittedValues] = useState<VideoParamValues>({});
  const [source, setSource] = useState<ToolAsset | null>(null);
  const [selectedModelReady, setSelectedModelReady] = useState(false);
  const [quoteCredits, setQuoteCredits] = useState<number | null>(null);
  const hydratedCapability = useRef<string | null>(null);

  const { submitting, result, run } = useToolTask({
    capability: IMAGE_TO_VIDEO_CAPABILITY,
    successMessage: '视频已生成',
  });

  // 只在本能力首次到达时灌入后端默认值；此后保留用户修改，不被缓存刷新覆盖。
  useEffect(() => {
    if (!definition || hydratedCapability.current === definition.id) return;
    hydratedCapability.current = definition.id;
    setValues(videoParamDefaults(definition.params));
  }, [definition]);

  const formValid = isVideoFormReady(params, values) && selectedModelReady;
  const creditLabel =
    quoteCredits === null
      ? undefined
      : quoteCredits > 0
        ? `本次约 ${quoteCredits} 积分`
        : '免费';
  const unavailable = definition?.runtime && definition.runtime.effective !== 'remote';

  return (
    <ToolShell
      capability={IMAGE_TO_VIDEO_CAPABILITY}
      pageClass="image-to-video-page"
      title="图生视频"
      desc="上传首帧图片，描述画面运动，生成可下载的短视频"
      upload={{
        title: '上传首帧图片',
        required: true,
        max: 1,
        hint: '点击、拖拽或粘贴图片上传，支持 JPG、PNG、WebP，最多 1 张',
        prompt: '点击或拖拽图片到此处，作为视频首帧',
        promptIcon: <Plus size={22} />,
      }}
      replaceUpload
      renderUploadPreview={(images, controls) =>
        images[0] ? <VideoUploadPreview image={images[0]} controls={controls} /> : null
      }
      onImagesChange={(images) => setSource(images[0] ?? null)}
      submitLabel="立即生成"
      creditLabel={creditLabel}
      hint={
        unavailable
          ? '当前能力暂不可提交，请稍后再试'
          : !formValid
            ? '选择可用模型并确认视频参数后即可提交'
            : '* 确认素材和参数后提交，右侧会展示生成结果。'
      }
      emptyDesc="上传首帧图片并填写动态描述后，视频结果将在此处展示"
      formValid={formValid}
      submitting={submitting}
      result={result}
      resultPane={
        <VideoResultPane
          source={source}
          result={result}
          submitting={submitting}
          params={params}
          submittedValues={submittedValues}
          currentValues={values}
        />
      }
      onSubmit={async (inputs) => {
        setSubmittedValues({ ...values });
        await run(inputs, buildImageToVideoPayload(params, values));
      }}
    >
      <VideoSettingsCard
        definition={definition}
        loading={loading}
        error={error}
        runtime={definition?.runtime}
        values={values}
        onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
        onModelChange={(model) => setSelectedModelReady(Boolean(model?.available))}
        onQuoteChange={setQuoteCredits}
      />
    </ToolShell>
  );
}
