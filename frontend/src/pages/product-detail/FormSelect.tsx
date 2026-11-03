import { Select } from '../../ui';
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
  // Select 不用 <label> 包裹: label 会把点击转发给触发按钮, 表现为「打开即关闭」;
  // 无障碍名走 aria-label。
  return (
    <div className="pk-field">
      <span className="pk-field-label">{label}</span>
      <Select value={value} onChange={onChange} options={options} aria-label={label} />
    </div>
  );
}
