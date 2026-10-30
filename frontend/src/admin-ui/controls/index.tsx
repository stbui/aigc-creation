import { useRef, type ReactNode } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { Select, SelectItem } from '../../vendor/boardui/components/base/select/select';
import { Tooltip, TooltipTrigger } from '../../vendor/boardui/components/base/tooltip/tooltip';
import { Textarea } from '../../vendor/boardui/components/base/textarea/textarea';
import { Switch } from '../../vendor/boardui/components/base/switch/switch';
import { Checkbox } from '../../vendor/boardui/components/base/checkbox/checkbox';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../../vendor/boardui/components/base/segmented-control/segmented-control';
import {
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../vendor/boardui/components/base/tabs/tabs';
import { cx } from '../lib/cn';

/**
 * 后台表单控件（BoardUI）。
 *
 * ## 为什么自己包一层
 *
 * vendor 的 `Select` 是 React Aria 组合件：`Select` / `SelectItem` 分开用，
 * 值类型是 `Key | null`，没有「清空」概念。后台 49 处筛选器需要的是
 * 「value: string | undefined + allowClear」这一种形状，直接铺 RAC API 会让
 * 每个页面各写一遍 `__all__` 哨兵值。
 *
 * ## allowClear 的实现口径
 *
 * 不加嵌套按钮（RAC 的触发器本身是 `<button>`，里面再放按钮是非法结构），
 * 而是在选项表头补一条「全部」—— 选中即「不过滤」。这与筛选条本身的语义一致，
 * 也比一个需要精确点中的小叉号更适合键盘操作。
 */

/* ────────────────────────── 文本输入 ────────────────────────── */

export function TextInput({
  value,
  onChange,
  placeholder,
  allowClear = false,
  onEnter,
  ariaLabel,
  className,
  inputMode,
  maxLength,
  disabled = false,
  showCount = false,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  /** 回车即提交筛选，不等用户去点「查询」 */
  onEnter?: () => void;
  ariaLabel?: string;
  className?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  disabled?: boolean;
  /** 右下角显示 `12/80`，与 `maxLength` 搭配 */
  showCount?: boolean;
  /**
   * 日期类字段走原生控件：订单按日筛选、优惠券有效期必须用 `date` /
   * `datetime-local`，自己拼三组下拉在跨时区与「今天 23:59」上都会出错。
   *
   * `password` 用于访问令牌 —— 令牌是凭据，明文摊在屏幕上会被截图带出去。
   */
  type?: 'text' | 'date' | 'datetime-local' | 'password';
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cx('relative', className)}>
      <input
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={cx(
          'h-8 w-full rounded-lg border border-border-button-default bg-background-primary-default px-2.5 text-body-medium text-text-primary shadow-xs',
          'transition-colors placeholder:text-text-placeholder hover:border-border-button-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-border-focus-ring',
          disabled && 'cursor-not-allowed bg-background-secondary-default text-text-tertiary',
          allowClear && value && 'pr-7',
        )}
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute -bottom-4 right-0.5 text-[10px] tabular-nums text-text-placeholder">
          {value.length}/{maxLength}
        </span>
      )}
      {allowClear && value && !disabled && (
        <button
          type="button"
          aria-label="清空"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:text-text-primary"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ────────────────────────── 多行文本 ────────────────────────── */

/**
 * 多行输入。
 *
 * 下架原因、备注这类字段都要「有上限 + 显示计数」：上限由后端 DTO 决定，
 * 前端只负责在到达上限前让用户看见还剩多少字，不做事后报错。
 */
export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  showCount = false,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  showCount?: boolean;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Textarea
      className={className}
      aria-label={ariaLabel ?? placeholder}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      showCount={showCount}
      isDisabled={disabled}
    />
  );
}

/* ────────────────────────── 数字输入 ────────────────────────── */

/**
 * 整数输入（积分价、上限条数这类）。
 *
 * 为什么不用 `<input type="number">` 的原生步进：antd 的 InputNumber 有
 * 步进按钮，运营改积分价时直接点 +1 比手打更稳；这里保留原生 input 的键盘
 * 行为，只在右侧补一对步进按钮，`min` / `max` 同时约束输入与步进。
 */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  disabled = false,
  onEnter,
  ariaLabel,
  className,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  onEnter?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const clamp = (next: number) => {
    let result = next;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    return result;
  };

  const step = (delta: number) => {
    if (disabled) return;
    onChange(clamp((value ?? min ?? 0) + delta));
  };

  const inputClass = cx(
    'h-8 w-full rounded-lg border border-border-button-default bg-background-primary-default pl-2.5 text-body-medium text-text-primary shadow-xs tabular-nums',
    'transition-colors hover:border-border-button-hover',
    'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-border-focus-ring',
    disabled ? 'cursor-not-allowed opacity-60' : 'pr-6',
  );

  return (
    <div className={cx('relative', className)}>
      <input
        type="number"
        inputMode="numeric"
        value={value === undefined || Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? undefined : clamp(Number(raw)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={inputClass}
      />
      {!disabled && (
        <div className="absolute right-0 top-0 flex h-8 w-5 flex-col overflow-hidden rounded-r-lg border-l border-border-table">
          <button
            type="button"
            aria-label="增加"
            tabIndex={-1}
            className="flex-1 text-[9px] leading-none text-text-tertiary hover:bg-background-secondary-default hover:text-text-primary"
            onClick={() => step(1)}
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="减少"
            tabIndex={-1}
            className="flex-1 border-t border-border-table text-[9px] leading-none text-text-tertiary hover:bg-background-secondary-default hover:text-text-primary"
            onClick={() => step(-1)}
          >
            ▼
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── 开关 ────────────────────────── */

/**
 * 布尔开关。
 *
 * React Aria 的 `Switch` 用 `isSelected`，与 antd 的 `checked` 不同名；
 * 页面统一走 `checked` / `onChange(boolean)`，避免每个迁移点都记一次两套命名。
 */
export function SwitchBox({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** 无可见标签时（如表格行内开关）用它给出可读名 */
  ariaLabel?: string;
}) {
  return (
    <Switch
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
      className={className}
      aria-label={ariaLabel}
    >
      {label}
    </Switch>
  );
}

/* ────────────────────────── 复选框 ────────────────────────── */

/**
 * 复选框。
 *
 * 权限矩阵里一屏要铺「50 个权限点 × 3 个角色」= 150 个勾选框，所以标签
 * 必须可点（React Aria 把 label 与 input 关联好，点文字也能切换），
 * 并且 `disabled` 走 `isDisabled` 而不是屏蔽点击 —— 禁用态要有视觉反馈。
 */
export function CheckBox({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  indeterminate = false,
  size = 'md',
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  /** 无可见文字时的无障碍名（权限矩阵这类「一列一个勾」的场景） */
  ariaLabel?: string;
  disabled?: boolean;
  /** 半选：模块级「部分勾选」用它表达 */
  indeterminate?: boolean;
  size?: 'md' | 'sm';
  className?: string;
}) {
  return (
    <Checkbox
      isSelected={checked}
      isIndeterminate={indeterminate}
      isDisabled={disabled}
      size={size}
      aria-label={ariaLabel}
      className={className}
      onChange={onChange}
    >
      {label}
    </Checkbox>
  );
}

/* ────────────────────────── 分段切换 ────────────────────────── */

export interface SegmentedOption {
  value: string;
  /** 允许带计数，如 `紧急 3` */
  label: ReactNode;
}

/**
 * 分段切换（单选，不可回到空值）。
 *
 * 用在「同一份数据按维度切一刀」的地方：告警按级别、对账按状态。
 * 刻意不做成下拉 —— 维度选项少（2–5 个）且需要常驻可见，下拉会把当前维度藏起来。
 */
export function SegmentedBox({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      className={className}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next !== undefined) onChange(String(next));
      }}
    >
      {options.map((option) => (
        <SegmentedControlItem key={option.value} id={option.value}>
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

/* ────────────────────────── 文件选择 ────────────────────────── */

/**
 * 本地文件选择。
 *
 * 与 antd `Upload` 的差别：这里**不发请求**，只把 `File` 交给调用方。
 * 渠道账单导入、数据导入都需要「先选文件 → 再点导入」，选完即传会让
 * 「选错了但已经提交」变成常态。
 */
export function FilePick({
  file,
  accept,
  onPick,
  onClear,
  disabled = false,
  label = '选择文件',
  hint,
}: {
  file: File | null;
  accept?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
  label?: string;
  /** 未选文件时右侧的说明文字 */
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0];
          if (next) onPick(next);
          // 清空 value：否则连续选同一个文件不会再触发 change
          event.target.value = '';
        }}
      />
      <Button
        variant="secondary"
        size="small"
        leadingIcon={Paperclip}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      {file ? (
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-text-secondary">
          <span className="max-w-[240px] truncate" title={file.name}>
            {file.name}
          </span>
          <button
            type="button"
            aria-label="移除已选文件"
            className="rounded p-0.5 text-text-tertiary hover:text-rose-600 disabled:opacity-50"
            disabled={disabled}
            onClick={onClear}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ) : (
        hint && <span className="text-[11px] text-text-tertiary">{hint}</span>
      )}
    </div>
  );
}

/* ────────────────────────── 悬停说明 ────────────────────────── */

/**
 * 悬停/聚焦说明。
 *
 * 后台大量标签需要一句「这个值是什么意思」的解释（价格来源、通道冷却原因）。
 * 触发器统一用可聚焦的 `span`：纯文本标签不可聚焦，键盘用户就永远看不到说明。
 */
export function HoverTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <TooltipTrigger delay={120}>
      <span
        tabIndex={0}
        className="inline-flex cursor-help items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        {children}
      </span>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
}

/* ────────────────────────── 下拉选择 ────────────────────────── */

export interface SelectOption {
  value: string;
  label: string;
  /** 选项右侧的备注（如计数），不参与筛选值 */
  hint?: ReactNode;
}

interface SelectItemValue {
  value: string;
  label: string;
}

/** 「不过滤」哨兵值。用不可能与业务 id 冲突的字面量，且不出现在任何请求里 */
const ALL_KEY = '__all__';

export function SelectBox({
  value,
  onChange,
  options,
  placeholder = '请选择',
  allowClear = false,
  allLabel = '全部',
  ariaLabel,
  className,
  size = 'sm',
  disabled = false,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: SelectOption[];
  placeholder?: string;
  allowClear?: boolean;
  /** 「不过滤」那一项的文字，默认「全部」 */
  allLabel?: string;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const items: SelectItemValue[] = allowClear
    ? [{ value: ALL_KEY, label: allLabel }, ...options.map((o) => ({ value: o.value, label: o.label }))]
    : options.map((o) => ({ value: o.value, label: o.label }));

  const selectedKey = value ?? (allowClear ? ALL_KEY : null);

  return (
    <Select<SelectItemValue>
      aria-label={ariaLabel ?? placeholder}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        if (key === null || key === ALL_KEY) {
          onChange(undefined);
          return;
        }
        onChange(String(key));
      }}
      size={size}
      className={className}
      isDisabled={disabled}
      triggerClassName={cx(
        'h-8 rounded-lg py-0 shadow-xs',
        // 选中「全部」时按占位色显示，筛选条里才能一眼看出「这一项没在过滤」
        !value && 'text-text-placeholder',
      )}
      renderValue={({ selectedText, isPlaceholder }) =>
        isPlaceholder ? <span className="text-text-placeholder">{placeholder}</span> : selectedText
      }
    >
      {/*
       * ⚠ 必须传静态元素，不能传 `(item) => ...` 渲染函数。
       * vendor 的 `Select` 把 children 收成 `ReactNode`（不是 Collection 渲染函数），
       * 函数会被当成普通子节点交给 Provider，React 每次渲染都报
       * 「Functions are not valid as a React child」—— 选项能显示，但控制台一直是红的。
       */}
      {items.map((item) => (
        <SelectItem key={item.value} id={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </Select>
  );
}

/* ────────────────────────── 分页标签 ────────────────────────── */

/**
 * 分组页签。
 *
 * BoardUI 免费层没有 `Tabs`，但 vendor 的 `components/base/tabs` 是完整的
 * React Aria 实现（下划线样式 + 方向键导航 + 焦点管理），直接包一层即可。
 *
 * 为什么不用 antd 的 `Tabs`：antd 的 `Tabs` 只接受 `items` 数组，内容必须
 * 作为 `items[].children` 传入；而后台的页签内容往往是「随当前选中项变化的
 * 草稿」，需要在**页面组件内部**渲染。`TabPanel` 的 children 是函数，天然
 * 支持这种写法。
 *
 * `selectedKey` 受控：页签切换要写回 URL（如 `?group=refund`），不能只存在于
 * 组件内部状态。
 */
export function TabGroup({
  value,
  onChange,
  tabs,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 每项的 `id` 同时作为 `TabPanel` 的 key */
  tabs: Array<{ id: string; label: ReactNode; content: ReactNode }>;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Tabs
      className={className}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <TabList aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <Tab key={tab.id} id={tab.id}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} id={tab.id}>
          {tab.content}
        </TabPanel>
      ))}
    </Tabs>
  );
}

/* ────────────────────────── 取色 ────────────────────────── */

/**
 * 颜色选择。
 *
 * 用原生 `<input type="color">`：BoardUI 免费层没有取色器，而 React Aria 的
 * `ColorPicker` 需要额外的 `@react-stately/color` 组件族（vendor 未收录），
 * 自己实现一套 HSL 拾取器不值得 —— 原生控件在所有目标浏览器上都有系统级
 * 取色面板，且键盘可操作。
 *
 * 原生控件只能给 6 位 hex，与后端 `#rrggbb` 校验一致，所以旁边的文本框
 * 允许手填其它写法（校验失败时由页面提示，不在这里拦）。
 */
export function ColorBox({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safe}
        disabled={disabled}
        aria-label={ariaLabel ?? '选择颜色'}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border-table bg-white p-0.5 disabled:cursor-not-allowed"
      />
      <TextInput
        value={value}
        onChange={onChange}
        placeholder="#rrggbb"
        maxLength={7}
        disabled={disabled}
        ariaLabel={ariaLabel ? `${ariaLabel} 十六进制值` : '颜色十六进制值'}
        className="w-28"
      />
    </div>
  );
}

/* ────────────────────────── 滑块 ────────────────────────── */

/**
 * 数值滑块 + 数字输入（两者同步）。
 *
 * 样式页的字号、圆角、缩放这类字段需要「拖动看效果」：滑块负责连续调整，
 * 数字框负责精确输入。只给滑块，运营改一个像素要拖很久；只给数字框，
 * 「多大算合适」没有参照。
 */
export function RangeBox({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 数字框右侧的单位文字（如 `px` / `%`） */
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const safe = Number.isFinite(value) ? value : min;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safe}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-background-secondary-default accent-accent-600 disabled:cursor-not-allowed"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <NumberInput
          value={safe}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(next) => onChange(next ?? min)}
          ariaLabel={ariaLabel}
          className="w-20"
        />
        {suffix && <span className="text-xs text-text-tertiary">{suffix}</span>}
      </div>
    </div>
  );
}

/* ────────────────────────── 带建议的文本输入 ────────────────────────── */

/**
 * 带候选建议的文本输入。
 *
 * 用原生 `<datalist>`：AI 标识页要选字体族，antd 的 `AutoComplete` 在 BoardUI
 * 里没有对应件，而 `<datalist>` 的候选列表完全由浏览器渲染，零依赖、零状态。
 * 代价是候选以「前缀匹配」呈现，不能像 antd 那样给候选加说明 —— 字体列表
 * 本来也不需要说明。
 */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 候选项 */
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const listId = useRef(`suggest-${Math.random().toString(36).slice(2, 10)}`).current;
  return (
    <>
      <input
        list={listId}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cx(
          'h-8 w-full rounded-lg border border-border-button-default bg-background-primary-default px-2.5 text-body-medium text-text-primary shadow-xs',
          'transition-colors placeholder:text-text-placeholder hover:border-border-button-hover',
          'outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-border-focus-ring',
          disabled && 'cursor-not-allowed bg-background-secondary-default text-text-tertiary',
        )}
      />
      <datalist id={listId}>
        {suggestions.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </>
  );
}
