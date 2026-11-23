/** C 端 UI 唯一取用层。页面不直连 admin-ui 的原子件。 */
export { AppProvider, useApp, type AppApi, type ConfirmOptions } from './providers/AppProvider';
export { UiProvider } from './providers/UiProvider';
export { cn } from './lib/cn';

import type { ComponentProps, ReactNode } from 'react';
import { Button } from '~/admin-ui/components/ui/button';
import { Textarea as ShadcnTextarea } from '~/admin-ui/components/ui/textarea';
import { Checkbox as ShadcnCheckbox } from '~/admin-ui/components/ui/checkbox';
import { Switch as ShadcnSwitch } from '~/admin-ui/components/ui/switch';

export { Button };
export type ButtonProps = ComponentProps<typeof Button>;

export { ShadcnTextarea as Textarea };
export type TextareaProps = ComponentProps<typeof ShadcnTextarea>;

export { ShadcnCheckbox as Checkbox };
export type CheckboxProps = ComponentProps<typeof ShadcnCheckbox>;

export { ShadcnSwitch as Switch };
export type SwitchProps = ComponentProps<typeof ShadcnSwitch>;

/* Select 直连 shadcn 组合件：调用点自行组合 Trigger/Content/Item。 */
export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '~/admin-ui/components/ui/select';
export interface SelectOption {
  value: string | number;
  label: ReactNode;
}
import { Input as ShadcnInput } from '~/admin-ui/components/ui/input';

export { ShadcnInput as Input };
export type InputProps = ComponentProps<typeof ShadcnInput>;

export { RadioGroup, RadioGroupItem } from '~/admin-ui/components/ui/radio-group';
export { Slider } from '~/admin-ui/components/ui/slider';
export { NumberStepper, type NumberStepperProps } from './primitives/number-stepper';
export { Upload, type UploadFile, type UploadProps } from './primitives/upload';
export { IconInput, type IconInputProps } from './primitives/icon-input';
export {
  CharacterCountTextarea,
  type CharacterCountTextareaProps,
} from './primitives/character-count-textarea';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '~/admin-ui/components/ui/dropdown-menu';
import { Spinner } from '~/admin-ui/components/ui/spinner';

export { Spinner as Spin };
/* 表单直连 shadcn 组合件 + react-hook-form；`Form` 即 shadcn 的 FormProvider。 */
export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  useFormField,
} from '~/admin-ui/components/ui/form';
export { useForm, useWatch, type UseFormReturn as FormInstance } from 'react-hook-form';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '~/admin-ui/components/ui/dialog';

/* shadcn 组合式原子件的 C 端别名。 */
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
export { Badge } from '~/admin-ui/components/ui/badge';
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
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '~/admin-ui/components/ui/sheet';
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from '~/admin-ui/components/ui/popover';
export {
  ToggleGroup,
  ToggleGroupItem,
} from '~/admin-ui/components/ui/toggle-group';
export {
  Tabs as NavigationTabs,
  TabsList as NavigationTabsList,
  TabsTrigger as NavigationTabsTrigger,
  TabsContent as NavigationTabsContent,
} from '~/admin-ui/components/ui/tabs';
export { Tabs, TabsList, TabsTrigger, TabsContent } from '~/admin-ui/components/ui/tabs';
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '~/admin-ui/components/ui/table';
export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from '~/admin-ui/components/ui/pagination';
export { Separator } from '~/admin-ui/components/ui/separator';
export { Skeleton } from '~/admin-ui/components/ui/skeleton';
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from '~/admin-ui/components/ui/avatar';
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
export {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
} from '~/admin-ui/components/ui/attachment';
export {
  Item,
  ItemGroup,
  ItemSeparator,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemHeader,
  ItemFooter,
} from '~/admin-ui/components/ui/item';
export { Kbd, KbdGroup } from '~/admin-ui/components/ui/kbd';
export { Toggle } from '~/admin-ui/components/ui/toggle';
export { AspectRatio } from '~/admin-ui/components/ui/aspect-ratio';
export { ScrollArea, ScrollBar } from '~/admin-ui/components/ui/scroll-area';
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '~/admin-ui/components/ui/tooltip';
/* 文字动作：`Button variant="link"` 的 C 端默认密度，避免每处重复写尺寸与下划线。 */
export { TextAction, type TextActionProps } from './primitives/text-action';
/* 分段选择：Radix ToggleGroup 的受控单选封装，替代手写 tab 外观的过滤条。 */
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './primitives/segmented-control';
/* 图片拖拽上传区：shadcn Button 外壳 + 拖拽落点，空态统一入口。 */
export { ImageDropzone, type ImageDropzoneProps } from './primitives/dropzone';
