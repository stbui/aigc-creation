import type { ChangeEventHandler } from 'react';
import type { CapabilityParam } from '../../types/api';
import {
  FormItem,
  Input,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Switch,
  Textarea,
  useWatch,
} from './components';
import { PARAM_TEXT_MAX_LENGTH, PARAM_TEXT_ROWS } from './constants';

interface ToolParamFieldProps {
  param: CapabilityParam;
}

/** 文本参数：value/onChange 由 FormItem 的 field 提供，计数用 useWatch 订阅同一字段。 */
function ParamTextArea({
  paramKey,
  maxLength,
  placeholder,
  value,
  onChange,
}: {
  paramKey: string;
  maxLength: number;
  placeholder?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
}) {
  const watched = useWatch(paramKey);
  const length = typeof watched === 'string' ? watched.length : (value?.length ?? 0);
  return (
    <div className="login-textarea-wrap">
      <Textarea
        className="login-textarea field-sizing-fixed"
        rows={PARAM_TEXT_ROWS}
        maxLength={maxLength}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
      />
      <span className="login-textarea-count">{length}/{maxLength}</span>
    </div>
  );
}

/** 按后端参数声明渲染单个表单项（enum / number / boolean / text）。 */
export function ToolParamField({ param }: ToolParamFieldProps) {
  switch (param.type) {
    case 'enum':
      return (
        <FormItem name={param.key} label={param.label} description={param.help}>
          {({ field }) => (
            <RadioGroup
              value={String(field.value ?? '')}
              onValueChange={(value) => field.onChange(value)}
              aria-label={param.label}
              className="flex flex-wrap gap-2"
            >
              {(param.options ?? []).map((option) => {
                const value = String(option.value);
                return (
                  <label
                    key={value}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <RadioGroupItem value={value} id={`${param.key}-${value}`} />
                    {option.label}
                  </label>
                );
              })}
            </RadioGroup>
          )}
        </FormItem>
      );
    case 'number':
      return (
        <FormItem name={param.key} label={param.label} description={param.help}>
          {({ field }) => (
            <div className="tool-param-number">
              <Slider
                min={param.min}
                max={param.max}
                step={param.step}
                value={[Number(field.value ?? param.min ?? 0)]}
                onValueChange={(next) => field.onChange(Array.isArray(next) ? next[0] : next)}
                thumbAriaLabel={param.label}
              />
              <Input
                type="number"
                min={param.min}
                max={param.max}
                step={param.step}
                value={field.value === null || field.value === undefined ? '' : String(field.value)}
                onChange={(event) => {
                  const raw = event.target.value;
                  field.onChange(raw === '' ? null : Number(raw));
                }}
                aria-label={param.label}
              />
            </div>
          )}
        </FormItem>
      );
    case 'boolean':
      return (
        <FormItem name={param.key} label={param.label} description={param.help}>
          {({ field }) => (
            <Switch checked={Boolean(field.value)} onCheckedChange={(next) => field.onChange(next)} />
          )}
        </FormItem>
      );
    case 'text':
    default:
      return (
        <FormItem
          name={param.key}
          label={param.label}
          description={param.help}
          rules={
            param.pattern
              ? [{ pattern: new RegExp(param.pattern), message: `${param.label}格式不正确` }]
              : undefined
          }
        >
          {({ field }) => (
            <ParamTextArea
              paramKey={param.key}
              maxLength={param.maxLength ?? PARAM_TEXT_MAX_LENGTH}
              placeholder={param.placeholder}
              value={field.value as string | undefined}
              onChange={field.onChange}
            />
          )}
        </FormItem>
      );
  }
}
