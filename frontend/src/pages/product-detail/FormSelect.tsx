import type { ParamOption } from './components';

/**
 * 生成设置里的下拉 (平台 / 语言)。
 *
 * 两处结构相同, 抽成一个避免复制粘贴 —— 字段名 / 说明 / 选项列表完全一致,
 * 只有标签不同。
 *
 * 纯展示: 受控组件, 选中值由页面持有。
 */

interface FormSelectProps {
  label: string;
  value: string;
  options: ParamOption[];
  onChange: (value: string) => void;
}

export function FormSelect({ label, value, options, onChange }: FormSelectProps) {
  return (
    <label className="pk-field">
      <span className="pk-field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
