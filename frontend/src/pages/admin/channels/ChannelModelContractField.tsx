import { Controller, type Control } from 'react-hook-form';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Panel,
  TextAreaField,
} from '~/admin-ui/primitives';
import type { ModelDraft } from './constants';

export function ChannelModelContractField({
  control,
  capability,
}: {
  control: Control<ModelDraft>;
  capability: string;
}) {
  const isText = capability === 'text';
  const title = isText ? '文本能力配置' : '能力配置（可选）';
  const note = isText
    ? '保存文本模型时必填；请配置上下文窗口、输出上限与引用素材限制'
    : '按需说明支持的输入素材、选项范围与图片尺寸；留空使用默认配置';
  const description = isText
    ? '切换为文本能力时已填入可保存的默认合同，请按上游模型实际能力调整'
    : '按需说明支持的输入素材、选项范围与图片尺寸；留空使用默认配置';

  return (
    <Panel title={title} note={note}>
      <Controller
        control={control}
        name="capabilityConfig"
        render={({ field, fieldState }) => {
          const controlId = 'channel-model-capability-config';
          const descriptionId = `${controlId}-description`;
          const errorId = `${controlId}-error`;
          return (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={controlId}>能力配置</FieldLabel>
              <TextAreaField
                id={controlId}
                ariaLabel="能力配置"
                value={field.value}
                onChange={field.onChange}
                rows={8}
                placeholder={'{\n  "inputs": { "image": { "min": 0, "max": 4 } },\n  "options": { "size": { "values": ["1024x1024", "1536x1024"] } }\n}'}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.error ? errorId : descriptionId}
              />
              {fieldState.error ? (
                <FieldError id={errorId} errors={[fieldState.error]} />
              ) : (
                <FieldDescription id={descriptionId}>
                  {description}
                </FieldDescription>
              )}
            </Field>
          );
        }}
      />
    </Panel>
  );
}
