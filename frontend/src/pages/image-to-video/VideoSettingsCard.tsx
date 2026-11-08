import { AlertCircle } from 'lucide-react';

import type { PublicLogicalModel } from './components';
import { ModelPicker, PillOptions, ToolCard } from './components';
import {
  PROMPT_MAX_LENGTH,
  PROMPT_PARAM_KEY,
  type CapabilityDef,
  type CapabilityRuntime,
} from './constants';
import {
  videoEnumParams,
  videoTextParams,
  type VideoParamValues,
} from './utils';

interface VideoSettingsCardProps {
  definition: CapabilityDef | null;
  loading: boolean;
  error: string | null;
  runtime?: CapabilityRuntime;
  values: VideoParamValues;
  onChange: (key: string, value: string) => void;
  onModelChange: (model: PublicLogicalModel | null) => void;
  onQuoteChange: (credits: number | null) => void;
}

/**
 * 视频创作卡：动态描述 + 能力参数 + 模型/实时报价。
 *
 * 参数结构完全按 `/capabilities` 的 `params` 渲染，不在页面写死
 * 「6 秒 / 10 秒 / 720P / 1080P」等厂商枚举。这样后台调整参数或模型报价时，
 * 页面无需跟着改代码。
 */
export function VideoSettingsCard({
  definition,
  loading,
  error,
  runtime,
  values,
  onChange,
  onModelChange,
  onQuoteChange,
}: VideoSettingsCardProps) {
  const unavailable = runtime && runtime.effective !== 'remote' ? runtime : null;
  const params = definition?.params ?? [];
  const textParams = videoTextParams(params);
  const enumParams = videoEnumParams(params);

  return (
    <ToolCard title="视频设置" className="image-to-video-settings-card">
      {loading && (
        <div className="image-to-video-settings-loading" aria-live="polite">
          <span className="image-to-video-loading-line" />
          <span className="image-to-video-loading-line is-short" />
          <span className="image-to-video-loading-line" />
        </div>
      )}

      {error && (
        <div className="image-to-video-config-error" role="alert">
          <AlertCircle size={16} />
          <span>视频参数加载失败：{error}</span>
        </div>
      )}

      {unavailable && (
        <div className="image-to-video-runtime-notice" role="status">
          <AlertCircle size={17} />
          <div>
            <strong>当前暂无可用模型线路</strong>
            <span>{unavailable.reason || '提交入口已暂时关闭，请稍后再试。'}</span>
          </div>
        </div>
      )}

      {!loading && !error && definition && (
        <>
          {textParams.map((param) => {
            const isPrompt = param.key === PROMPT_PARAM_KEY;
            return (
              <label className="image-to-video-prompt" key={param.key} htmlFor={`video-param-${param.key}`}>
                <span>{param.label}</span>
                <textarea
                  id={`video-param-${param.key}`}
                  value={values[param.key] ?? ''}
                  maxLength={param.maxLength ?? (isPrompt ? PROMPT_MAX_LENGTH : undefined)}
                  placeholder={param.placeholder}
                  rows={isPrompt ? 4 : 3}
                  onChange={(event) => onChange(param.key, event.target.value)}
                />
                {param.help && <small>{param.help}</small>}
              </label>
            );
          })}

          {enumParams.map((param) => (
            <div className="image-to-video-param" key={param.key}>
              <div className="image-to-video-param-head">
                <strong>{param.label}</strong>
                {param.help && <span>{param.help}</span>}
              </div>
              <PillOptions
                options={(param.options ?? []).map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
                value={values[param.key] ?? ''}
                onChange={(value) => onChange(param.key, value)}
                ariaLabel={param.label}
              />
            </div>
          ))}

          <ModelPicker
            capability={definition.id}
            options={values}
            onModelChange={onModelChange}
            onQuoteChange={onQuoteChange}
            className="image-to-video-model-picker"
          />
        </>
      )}

      {!loading && !error && !definition && (
        <div className="image-to-video-config-error" role="alert">
          <AlertCircle size={16} />
          <span>能力清单中未找到图生视频配置，请稍后刷新重试。</span>
        </div>
      )}
    </ToolCard>
  );
}
