import type { ChangeEventHandler } from 'react';
import type { CapabilityParam } from '../../types/api';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Switch,
  Textarea,
} from './components';
import { PARAM_TEXT_MAX_LENGTH, PARAM_TEXT_ROWS } from './constants';

interface ToolParamFieldProps {
  param: CapabilityParam;
}

/** 文本参数：value/onChange 由 FormField 提供，计数直接读当前值。 */
function ParamTextArea({
  maxLength,
  placeholder,
  value,
  onChange,
}: {
  maxLength: number;
  placeholder?: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
}) {
  const length = value?.length ?? 0;
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
      <span className="login-textarea-count is-block">{length}/{maxLength}</span>
    </div>
  );
}

/** 按后端参数声明渲染单个表单项（enum / number / boolean / text）。 */
export function ToolParamField({ param }: ToolParamFieldProps) {
  switch (param.type) {
    case 'enum':
      return (
        <FormField
          name={param.key}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{param.label}</FormLabel>
              <FormControl>
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
              </FormControl>
              {param.help && <FormDescription>{param.help}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case 'number':
      return (
        <FormField
          name={param.key}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{param.label}</FormLabel>
              <FormControl>
                <div className="grid grid-cols-[1fr_88px] items-center gap-3">
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
                    value={
                      field.value === null || field.value === undefined ? '' : String(field.value)
                    }
                    onChange={(event) => {
                      const raw = event.target.value;
                      field.onChange(raw === '' ? null : Number(raw));
                    }}
                    aria-label={param.label}
                  />
                </div>
              </FormControl>
              {param.help && <FormDescription>{param.help}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case 'boolean':
      return (
        <FormField
          name={param.key}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{param.label}</FormLabel>
              <FormControl>
                <Switch
                  checked={Boolean(field.value)}
                  onCheckedChange={(next) => field.onChange(next)}
                />
              </FormControl>
              {param.help && <FormDescription>{param.help}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
      );
    case 'text':
    default:
      return (
        <FormField
          name={param.key}
          rules={{
            validate: (value) =>
              !param.pattern || !value || new RegExp(param.pattern).test(String(value))
                ? true
                : `${param.label}格式不正确`,
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{param.label}</FormLabel>
              <FormControl>
                <ParamTextArea
                  maxLength={param.maxLength ?? PARAM_TEXT_MAX_LENGTH}
                  placeholder={param.placeholder}
                  value={field.value as string | undefined}
                  onChange={field.onChange}
                />
              </FormControl>
              {param.help && <FormDescription>{param.help}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
      );
  }
}
