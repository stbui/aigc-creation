import { useEffect, useRef, useState } from 'react';
import { Controller, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import { RotateCcw } from 'lucide-react';
import {
  ActionButton,
  CheckboxField,
  Descriptions,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
  Notice,
  NumberField,
  Panel,
  SegmentedGroup,
  SwitchField,
  TextField,
  ToneBadge,
} from '~/admin-ui/primitives';
import type { ModelDraft } from './constants';
import { ChannelModelImageDerivedSummary } from './ChannelModelImageDerivedSummary';
import {
  createDefaultImageCapabilityConfigJson,
  imageParameterValuesEqual,
  normalizeImageCapabilityConfig,
  readImageCapabilityConfig,
  resolveParameterSettings,
  serializeImageCapabilityConfig,
  setImageParameterEnabled,
  setImageParameterValues,
  type ImageCapabilityConfigView,
  type ImageParameterDefinitionView,
  type ImageParameterSettingView,
} from './imageCapability';

const MEGABYTE = 1024 * 1024;

const TYPE_LABELS: Record<string, string> = {
  string: '文本',
  number: '数值',
  integer: '整数',
  boolean: '布尔',
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parameterScope(definition: ImageParameterDefinitionView): string {
  const models = definition.models ?? [];
  return models.length === 0 ? '全部服务商模型' : models.join('、');
}

function settingFor(
  settings: ImageParameterSettingView[],
  name: string,
): ImageParameterSettingView | undefined {
  return settings.find((setting) => setting.name === name);
}

/** 图片模型能力参数：协议参数由插件声明，运营只选择启用项与可选值。 */
export function ChannelModelImageCapabilityField({
  control,
  protocol,
  protocolLabel,
  protocolLoading,
  definitions,
  model,
  setValue,
}: {
  control: Control<ModelDraft>;
  protocol: string;
  protocolLabel?: string;
  protocolLoading: boolean;
  definitions: ImageParameterDefinitionView[];
  model: string;
  setValue: UseFormSetValue<ModelDraft>;
}) {
  const rawConfig = useWatch({ control, name: 'capabilityConfig' });
  const previousProtocol = useRef(protocol);
  const [protocolChanged, setProtocolChanged] = useState(false);

  useEffect(() => {
    if (previousProtocol.current === protocol) return;
    previousProtocol.current = protocol;
    setProtocolChanged(Boolean(protocol && rawConfig.trim()));
  }, [protocol, rawConfig]);

  useEffect(() => {
    if (!protocol || protocolLoading || rawConfig.trim()) return;
    setValue(
      'capabilityConfig',
      createDefaultImageCapabilityConfigJson(definitions, model),
      { shouldDirty: true, shouldValidate: false },
    );
  }, [definitions, model, protocol, protocolLoading, rawConfig, setValue]);

  return (
    <Panel title="图片能力参数" note="设置参考素材范围与可用参数；尺寸、分辨率、质量和输出数量会自动更新">
      {!protocol ? (
        <Notice tone="info">请先选择接入方式，再配置图片能力参数。</Notice>
      ) : protocolLoading ? (
        <Notice tone="info">正在读取可用参数…</Notice>
      ) : (
        <Controller
          control={control}
          name="capabilityConfig"
          render={({ field, fieldState }) => {
            const parsed = readImageCapabilityConfig(field.value);
            const image = normalizeImageCapabilityConfig(parsed, definitions, model);
            const settings = resolveParameterSettings(definitions, image.parameters, model);
            const commit = (next: ImageCapabilityConfigView) => {
              field.onChange(serializeImageCapabilityConfig(field.value, next));
            };
            const reset = () => {
              field.onChange(createDefaultImageCapabilityConfigJson(definitions, model));
              setProtocolChanged(false);
            };
            const updateReferences = (patch: Partial<ImageCapabilityConfigView['references']>) => {
              commit({
                ...image,
                references: { ...image.references, ...patch },
              });
            };
            const updateParameter = (
              definition: ImageParameterDefinitionView,
              setting: ImageParameterSettingView,
              enabled: boolean,
            ) => {
              commit(setImageParameterEnabled(image, definitions, definition.name, enabled, model));
            };
            const toggleValue = (
              definition: ImageParameterDefinitionView,
              setting: ImageParameterSettingView,
              value: unknown,
              checked: boolean,
            ) => {
              const selected = setting.values ?? [];
              const next = checked
                ? [...selected, value]
                : selected.filter((item) => !imageParameterValuesEqual(item, value));
              commit(setImageParameterValues(image, definitions, definition.name, next, model));
            };

            return (
              <Field data-invalid={fieldState.invalid} className="gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <FieldDescription>
                    当前接口：{protocolLabel || protocol}。系统推荐的默认值与可用范围仅供查看。
                  </FieldDescription>
                  <ActionButton
                    variant="secondary"
                    size="xs"
                    icon={RotateCcw}
                    onClick={reset}
                  >
                    使用推荐值
                  </ActionButton>
                </div>

                {protocolChanged && (
                  <Notice tone="warn" title="接入方式已变更">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>当前配置仍保留上一个接口的参数，可切换为新接口的推荐值。</span>
                      <ActionButton variant="secondary" size="xs" onClick={reset}>
                        使用新接口推荐值
                      </ActionButton>
                    </div>
                  </Notice>
                )}

                {field.value.trim() && !parsed && (
                  <Notice tone="warn">
                    当前配置无法读取；修改任一参数后会重新生成。
                  </Notice>
                )}

                <FieldGroup className="gap-5">
                  <FieldSet className="gap-3">
                    <div>
                      <FieldLegend variant="label">参考素材限制</FieldLegend>
                      <FieldDescription>保存后立即生效。</FieldDescription>
                    </div>
                    <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="image-prompt-max-chars">提示词最大字符数</FieldLabel>
                        <NumberField
                          id="image-prompt-max-chars"
                          ariaLabel="提示词最大字符数"
                          value={image.references.promptMaxChars}
                          min={1}
                          max={1_000_000}
                          onChange={(next) => {
                            if (next !== undefined) updateReferences({ promptMaxChars: next });
                          }}
                        />
                        <FieldDescription>1–1,000,000 字符</FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="image-max-references">最大参考图数</FieldLabel>
                        <NumberField
                          id="image-max-references"
                          ariaLabel="最大参考图数"
                          value={image.references.maxImages}
                          min={0}
                          max={100}
                          onChange={(next) => {
                            if (next !== undefined) updateReferences({ maxImages: next });
                          }}
                        />
                        <FieldDescription>0–100 张；纯文生图可设为 0</FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="image-max-bytes">最大参考图体积（MB）</FieldLabel>
                        <NumberField
                          id="image-max-bytes"
                          ariaLabel="最大参考图体积（MB）"
                          value={Math.round((image.references.maxImageBytes / MEGABYTE) * 100) / 100}
                          min={0}
                          step={0.1}
                          onChange={(next) => {
                            if (next !== undefined) {
                              updateReferences({ maxImageBytes: Math.round(next * MEGABYTE) });
                            }
                          }}
                        />
                        <FieldDescription>保存时换算为字节</FieldDescription>
                      </Field>
                      <Field orientation="horizontal" className="rounded-lg border border-border px-3 py-2.5">
                        <FieldContent>
                          <FieldTitle>支持遮罩</FieldTitle>
                          <FieldDescription>图生图时允许上传遮罩图层</FieldDescription>
                        </FieldContent>
                        <SwitchField
                          checked={image.references.maskSupported}
                          ariaLabel="支持遮罩"
                          onChange={(checked) => updateReferences({ maskSupported: checked })}
                        />
                      </Field>
                    </FieldGroup>
                  </FieldSet>

                  <FieldSet className="gap-3">
                    <div>
                      <FieldLegend variant="label">可用参数</FieldLegend>
                      <FieldDescription>
                        可调整启用状态与可选值；必填参数不可关闭，至少保留一个可选值。
                      </FieldDescription>
                    </div>
                    {definitions.length === 0 ? (
                      <Notice tone="info">
                        当前接口没有可配置参数，仍可设置参考素材与输出方式。
                      </Notice>
                    ) : (
                      <FieldGroup className="gap-3">
                        {definitions.map((definition) => {
                          const setting = settingFor(settings, definition.name) ?? {
                            name: definition.name,
                            enabled: definition.enabled ?? true,
                            values: definition.values,
                          };
                          const values = setting.values ?? [];
                          const hasEnum = (definition.values ?? []).length > 0;
                          return (
                            <Field
                              key={definition.name}
                              className="rounded-lg border border-border p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <FieldContent>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <FieldTitle>{definition.label}</FieldTitle>
                                    <ToneBadge tone="neutral">
                                      {TYPE_LABELS[definition.type] ?? definition.type}
                                    </ToneBadge>
                                    {definition.required && (
                                      <ToneBadge tone="warn">必填</ToneBadge>
                                    )}
                                    {definition.pricing && (
                                        <ToneBadge tone="brand">参与售价方案计价</ToneBadge>
                                    )}
                                  </div>
                                  {definition.description && (
                                    <FieldDescription>{definition.description}</FieldDescription>
                                  )}
                                </FieldContent>
                                <SwitchField
                                  checked={setting.enabled}
                                  disabled={definition.required === true}
                                  ariaLabel={`启用参数 ${definition.label}`}
                                  onChange={(checked) => updateParameter(definition, setting, checked)}
                                />
                              </div>

                              <Descriptions
                                columns={3}
                                items={[
                                  {
                                    label: '参数名',
                                    value: <code className="text-xs">{definition.name}</code>,
                                  },
                                  { label: '默认值', value: formatValue(definition.default) },
                                  { label: '作用范围', value: parameterScope(definition) },
                                  ...(definition.binding
                                    ? [{
                                        label: '绑定字段',
                                        value: <code className="text-xs">{definition.binding}</code>,
                                      }]
                                    : []),
                                  ...(definition.min !== undefined || definition.max !== undefined
                                    ? [{
                                        label: '取值范围',
                                        value: `${formatValue(definition.min)} – ${formatValue(definition.max)}`,
                                      }]
                                    : []),
                                  ...(definition.maxLength !== undefined
                                    ? [{ label: '最大长度', value: definition.maxLength }]
                                    : []),
                                ]}
                              />

                              {hasEnum ? (
                                <FieldSet className="gap-2">
                                  <FieldLegend variant="label" className="text-xs text-muted-foreground">
                                    可选值
                                  </FieldLegend>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {(definition.values ?? []).map((value, index) => {
                                      const checked = values.some((item) =>
                                        imageParameterValuesEqual(item, value),
                                      );
                                      return (
                                        <CheckboxField
                                          key={`${definition.name}-${index}`}
                                          checked={checked}
                                          disabled={
                                            checked &&
                                            (values.length === 1 ||
                                              imageParameterValuesEqual(value, definition.default))
                                          }
                                          ariaLabel={`${definition.label} 可选值 ${formatValue(value)}`}
                                          label={
                                            <span className="font-mono text-xs">
                                              {formatValue(value)}
                                            </span>
                                          }
                                          onChange={(next) =>
                                            toggleValue(definition, setting, value, next)
                                          }
                                        />
                                      );
                                    })}
                                  </div>
                                </FieldSet>
                              ) : (
                                <FieldDescription>由插件声明的类型与范围约束，无需选择枚举值。</FieldDescription>
                              )}
                            </Field>
                          );
                        })}
                      </FieldGroup>
                    )}
                  </FieldSet>

                  <FieldSet className="gap-3">
                    <div>
                      <FieldLegend variant="label">响应与输出</FieldLegend>
                      <FieldDescription>声明调用成功后返回的图片来源与默认图片格式。</FieldDescription>
                    </div>
                    <Field orientation="horizontal" className="rounded-lg border border-border px-3 py-2.5">
                      <FieldContent>
                        <FieldTitle>支持响应格式</FieldTitle>
                        <FieldDescription>不支持时留空，由服务商默认方式决定</FieldDescription>
                      </FieldContent>
                      <SwitchField
                        checked={image.responseFormat.supported}
                        ariaLabel="支持响应格式"
                        onChange={(checked) =>
                          commit({
                            ...image,
                            responseFormat: {
                              supported: checked,
                              default: checked ? image.responseFormat.default || 'auto' : 'auto',
                            },
                          })
                        }
                      />
                    </Field>
                    {image.responseFormat.supported && (
                      <Field>
                        <FieldLabel>图片响应格式</FieldLabel>
                        <SegmentedGroup
                          value={image.responseFormat.default || 'auto'}
                          ariaLabel="图片响应格式"
                          options={[
                            { value: 'auto', label: '自动' },
                            { value: 'b64_json', label: 'Base64' },
                            { value: 'url', label: 'URL' },
                          ]}
                          onChange={(value) =>
                            commit({
                              ...image,
                              responseFormat: { supported: true, default: value },
                            })
                          }
                        />
                      </Field>
                    )}

                    <Field orientation="horizontal" className="rounded-lg border border-border px-3 py-2.5">
                      <FieldContent>
                        <FieldTitle>支持指定图片格式</FieldTitle>
                        <FieldDescription>留空时使用服务商默认格式</FieldDescription>
                      </FieldContent>
                      <SwitchField
                        checked={image.outputFormat.supported}
                        ariaLabel="支持指定图片格式"
                        onChange={(checked) =>
                          commit({
                            ...image,
                            outputFormat: {
                              supported: checked,
                              default: checked ? image.outputFormat.default || 'png' : '',
                            },
                          })
                        }
                      />
                    </Field>
                    {image.outputFormat.supported && (
                      <Field>
                        <FieldLabel htmlFor="image-output-format">默认图片格式</FieldLabel>
                        <TextField
                          id="image-output-format"
                          ariaLabel="默认图片格式"
                          value={image.outputFormat.default ?? ''}
                          placeholder="如 png、jpeg、webp"
                          onChange={(value) =>
                            commit({
                              ...image,
                              outputFormat: { supported: true, default: value },
                            })
                          }
                        />
                      </Field>
                    )}
                  </FieldSet>

                  <ChannelModelImageDerivedSummary image={image} />
                </FieldGroup>

                {fieldState.error ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    保存时会整理可用参数，并同步更新尺寸、分辨率、质量和输出数量。
                  </FieldDescription>
                )}
              </Field>
            );
          }}
        />
      )}
    </Panel>
  );
}
