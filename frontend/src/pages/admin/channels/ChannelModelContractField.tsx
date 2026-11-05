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
}: {
  control: Control<ModelDraft>;
}) {
  return (
    <Panel
      title="能力合同（可选）"
      note="JSON，声明支持的输入素材数量、选项范围与图片尺寸；留空使用能力默认合同"
    >
      <Controller
        control={control}
        name="capabilityConfig"
        render={({ field, fieldState }) => {
          const controlId = 'channel-model-capability-config';
          const descriptionId = `${controlId}-description`;
          const errorId = `${controlId}-error`;
          return (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={controlId}>能力合同 JSON</FieldLabel>
              <TextAreaField
                id={controlId}
                ariaLabel="能力合同 JSON"
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
                  JSON，声明支持的输入素材数量、选项范围与图片尺寸；留空使用能力默认合同
                </FieldDescription>
              )}
            </Field>
          );
        }}
      />
    </Panel>
  );
}
