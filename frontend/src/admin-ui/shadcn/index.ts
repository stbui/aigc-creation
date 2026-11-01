/**
 * shadcn 版后台页面骨架与表单控件出口。
 *
 * ## 与 BoardUI 两套的关系
 *
 * 后台 35 个既有页面用的是 BoardUI 版骨架与控件（`admin-ui/widgets/AdminChrome`
 * 与 `admin-ui/controls`），保留不动。新写的页面走这个出口。
 *
 * **按页面边界切，不混用**：一个页面要么全用旧控件，要么全用新的 —— 混用会
 * 在同一张表单里出现两套圆角（8px vs 12px）与两套描边色。
 *
 * ## 为什么这一层存在
 *
 * shadcn 官方组件是「原子件」（Button / Input / Select），后台页面真正需要的是
 * 「后台形态」（带说明的字段、带计数与清空的输入、带步进的数字框）。这一层把
 * 项目要的几种形态收成可直接用的控件，页面里就不必每处重写样式。
 *
 * ## 存量页面换皮看 `./kit`
 *
 * 这里的签名是按「新页面怎么写最顺」设计的。存量页面（如渠道工作台）的调用点
 * 铺在几千行业务代码里，改签名等于全量重写 —— 那类页面走 `./kit`：导出件与
 * BoardUI 版**同名同签名**，换 import 来源即可整页换观感。
 *
 * ## 颜色
 *
 * 全部走 shadcn 语义令牌（`bg-background` / `border-input` / `text-foreground`），
 * 由 `admin-ui/styles/shadcn-theme.css` 桥接到项目既有令牌（`global.css` 的
 * `--brand` / `--text-strong` / `--border`）—— 改品牌色仍然只改一处。
 */

export {
  PageTitle,
  Panel,
  StatCard,
  SaveBar,
  EmptyState,
  AdminEmpty,
  AdminListError,
  AdminStaleError,
} from './layout';

export {
  FormField,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  SwitchField,
  ToneBadge,
  SegmentedTabs,
  ClearableField,
  ActionButton,
  type Tone,
  type SelectFieldOption,
} from './forms';
