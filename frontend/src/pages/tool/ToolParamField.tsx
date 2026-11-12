import type { CapabilityParam } from '../../types/api';
import { Form, Input, InputNumber, Radio, Slider, Switch } from './components';
import { PARAM_TEXT_MAX_LENGTH, PARAM_TEXT_ROWS } from './constants';

interface ToolParamFieldProps {
  param: CapabilityParam;
}

/** 按后端参数声明渲染单个表单项（enum / number / boolean / text）。 */
export function ToolParamField({ param }: ToolParamFieldProps) {
  switch (param.type) {
    case 'enum':
      return (
        <Form.Item name={param.key} label={param.label} tooltip={param.help}>
          <Radio.Group optionType="button" buttonStyle="solid">
            {(param.options ?? []).map((option) => (
              <Radio.Button key={String(option.value)} value={option.value}>
                {option.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>
      );
    case 'number':
      // Slider 与 InputNumber 共享同一个字段: 不能都塞进带 name 的 Form.Item
      // (兼容层只会把值注入其中一个), 改为受控读写表单状态, 保证两边同步。
      return (
        <Form.Item
          label={param.label}
          tooltip={param.help}
          shouldUpdate={(prev, next) => prev[param.key] !== next[param.key]}
          noStyle
        >
          {({ getFieldValue, setFieldsValue }) => (
            <div className="tool-param-field">
              <span className="tool-param-label">{param.label}</span>
              <div className="tool-param-number">
                <Slider
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={getFieldValue(param.key) as number}
                  onChange={(value) => setFieldsValue({ [param.key]: value })}
                  tooltip={{ formatter: (value) => String(value) }}
                />
                <InputNumber
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={getFieldValue(param.key) as number}
                  onChange={(value) => setFieldsValue({ [param.key]: value })}
                />
              </div>
            </div>
          )}
        </Form.Item>
      );
    case 'boolean':
      return (
        <Form.Item name={param.key} label={param.label} valuePropName="checked" tooltip={param.help}>
          <Switch />
        </Form.Item>
      );
    case 'text':
    default:
      return (
        <Form.Item
          name={param.key}
          label={param.label}
          tooltip={param.help}
          rules={
            param.pattern
              ? [{ pattern: new RegExp(param.pattern), message: `${param.label}格式不正确` }]
              : undefined
          }
        >
          <Input.TextArea
            rows={PARAM_TEXT_ROWS}
            placeholder={param.placeholder}
            maxLength={param.maxLength ?? PARAM_TEXT_MAX_LENGTH}
            showCount
          />
        </Form.Item>
      );
  }
}
