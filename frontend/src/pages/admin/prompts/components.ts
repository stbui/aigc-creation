/**
 * prompts 的外部控件唯一入口（按 `docs/design/standards/frontend-module-conventions.md` §2）。
 *
 * 目录内文件一律从 `./components` 取，不直连 `~/admin-ui`。
 */

export type { TagTone } from '~/components/admin/statusMeta';

export {
  ActionButton,
  AdminDataTable,
  AdminPage,
  type AdminColumn,
  type AppliedFilter,
  AppliedFilters,
  CheckboxField,
  ClearableField,
  ConfirmDialog,
  EmptyState,
  FilterActions,
  FilterBar,
  FormDrawer,
  FormField,
  ModalDialog,
  Notice,
  NumberField,
  Panel,
  RefreshButton,
  SelectField,
  SkeletonBody,
  Spinner,
  StaleError,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
  ToneBadge,
} from '~/admin-ui/radar';
