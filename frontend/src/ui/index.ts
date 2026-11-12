/** C 端 UI 唯一取用层。页面不直连 admin-ui 的原子件。 */
export { AppProvider, useApp, type AppApi, type ConfirmOptions } from './providers/AppProvider';
export { UiProvider } from './providers/UiProvider';
export { cn } from './lib/cn';

export { Button, type ButtonProps } from './primitives/button';
export { Input, type InputProps } from './primitives/input';
export { Textarea, type TextareaProps } from './primitives/textarea';
export { Select, type SelectProps, type SelectOption } from './primitives/select';
export { Checkbox, type CheckboxProps } from './primitives/checkbox';
export { Radio } from './primitives/radio';
export { Switch } from './primitives/switch';
export { Slider } from './primitives/slider';
export { InputNumber } from './primitives/input-number';
export { NumberStepper, type NumberStepperProps } from './primitives/number-stepper';
export { Upload, type UploadFile, type UploadProps } from './primitives/upload';
export { Modal, type ModalProps } from './primitives/modal';
export { Drawer, type DrawerProps } from './primitives/drawer';
export { Popover, type PopoverProps } from './primitives/popover';
export { Dropdown, type DropdownProps, type DropdownItem } from './primitives/dropdown';
export { Avatar, type AvatarProps } from './primitives/avatar';
export { Badge, type BadgeProps } from './primitives/badge';
export { Empty, type EmptyProps } from './primitives/empty';
export { Popconfirm, type PopconfirmProps } from './primitives/popconfirm';
export { Spin } from './primitives/spin';
export { Tabs, type TabsProps, type TabItem } from './primitives/tabs';
export { Pagination, type PaginationProps } from './primitives/pagination';
export { Table, type TableProps, type TableColumn } from './primitives/table';
export { Tag, Card, Row, Col, Alert, Typography } from './primitives/misc';
export { UiDialog } from './primitives/dialog';
export { ToggleGroup, type ToggleGroupOption, type ToggleGroupProps } from './primitives/toggle-group';
export { Form, FormItem, useForm, useWatch, type FormInstance } from './primitives/form';

/* shadcn 组合式原子件的 C 端别名：避免与 antd 兼容壳 Card 同名冲突。 */
export {
  Card as Surface,
  CardHeader as SurfaceHeader,
  CardTitle as SurfaceTitle,
  CardDescription as SurfaceDescription,
  CardContent as SurfaceContent,
  CardFooter as SurfaceFooter,
  CardAction as SurfaceAction,
} from '~/admin-ui/components/ui/card';
export { Badge as StatusBadge } from '~/admin-ui/components/ui/badge';
export {
  Empty as EmptyState,
  EmptyHeader as EmptyStateHeader,
  EmptyMedia as EmptyStateMedia,
  EmptyTitle as EmptyStateTitle,
  EmptyDescription as EmptyStateDescription,
  EmptyContent as EmptyStateContent,
} from '~/admin-ui/components/ui/empty';
export {
  Alert as InlineAlert,
  AlertTitle as InlineAlertTitle,
  AlertDescription as InlineAlertDescription,
} from '~/admin-ui/components/ui/alert';
export {
  Tabs as NavigationTabs,
  TabsList as NavigationTabsList,
  TabsTrigger as NavigationTabsTrigger,
} from '~/admin-ui/components/ui/tabs';
export { Separator } from '~/admin-ui/components/ui/separator';
export { Skeleton } from '~/admin-ui/components/ui/skeleton';
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '~/admin-ui/components/ui/field';
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '~/admin-ui/components/ui/input-group';
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '~/admin-ui/components/ui/context-menu';
