/**
 * 后台表单控件出口（shadcn 实现）。
 *
 * ## 为什么还留这一层
 *
 * 29 个存量页面一律从这里取 `TextInput` / `SelectBox` / `SwitchBox` 等，
 * 2026-11-01 整站换 shadcn 时保持**签名不变、实现指向 `admin-ui/shadcn/kit`**
 * —— 调用点一行不改，渲染全部换掉。
 *
 * ## 与 `shadcn/kit/controls` 的关系
 *
 * 那一层是真正的实现，且额外导出 `Button` / `IconButton` / `FormField`
 * （原先散在 vendor 与 `primitives` 里）。这里只转发表单件，避免同一份声明
 * 出现两个事实源。
 *
 * ## allowClear 的实现口径
 *
 * 不加嵌套按钮，而是在选项表头补一条「全部」（`ALL_KEY` 哨兵）—— 选中即
 * 「不过滤」。RAC 时代的开关语义原样保留，键盘可达。
 */

export {
  CheckBox,
  ColorBox,
  FilePick,
  HoverTip,
  NumberInput,
  RangeBox,
  SegmentedBox,
  SelectBox,
  SuggestInput,
  SwitchBox,
  TextArea,
  TextInput,
} from '../shadcn/kit/controls';
export type { SegmentedOption, SelectOption } from '../shadcn/kit/controls';
