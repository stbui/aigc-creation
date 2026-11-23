/** C 端 UI 唯一取用层。页面不直连 admin-ui 的原子件。 */
export { AppProvider, useApp, type AppApi, type ConfirmOptions } from './providers/AppProvider';
export { UiProvider } from './providers/UiProvider';
export { cn } from './lib/cn';

import type { ComponentProps, ReactNode } from 'react';
import { Button } from '~/admin-ui/components/ui/button';
import { Textarea } from '~/admin-ui/components/ui/textarea';
import { Checkbox } from '~/admin-ui/components/ui/checkbox';
import { Switch } from '~/admin-ui/components/ui/switch';

export { Button };
export type ButtonProps = ComponentProps<typeof Button>;

export { Textarea };
export type TextareaProps = ComponentProps<typeof Textarea>;

export { Checkbox };
export type CheckboxProps = ComponentProps<typeof Checkbox>;

export { Switch };
export type SwitchProps = ComponentProps<typeof Switch>;

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
import { Input } from '~/admin-ui/components/ui/input';

export { Input };
export type InputProps = ComponentProps<typeof Input>;

export { RadioGroup, RadioGroupItem } from '~/admin-ui/components/ui/radio-group';
export { Slider } from '~/admin-ui/components/ui/slider';
export { NumberStepper, type NumberStepperProps } from './primitives/number-stepper';
export { SectionCard, type SectionCardProps } from './primitives/section-card';
export {
  ImageUploadArea,
  type ImageUploadAreaProps,
  type ImageUploadControls,
  type ImageUploadItem,
} from './primitives/image-upload-area';
export { ImageUploadHeader, type ImageUploadHeaderProps } from './primitives/image-upload-header';
export { ImageUploadPrompt, type ImageUploadPromptProps } from './primitives/image-upload-prompt';
export { ImageUploadThumb, type ImageUploadThumbProps } from './primitives/image-upload-thumb';
export {
  ImageUploadAddTile,
  type ImageUploadAddTileProps,
} from './primitives/image-upload-add-tile';
export { ImageUploadLoading } from './primitives/image-upload-loading';
export { ImageUploadInput, type ImageUploadInputProps } from './primitives/image-upload-input';
export {
  ImageUploadTrigger,
  type ImageUploadTriggerProps,
} from './primitives/image-upload-trigger';
export {
  useImageUploadArea,
  type UseImageUploadAreaOptions,
  type UseImageUploadAreaResult,
} from './primitives/use-image-upload-area';
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

export { Spinner };
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

/* shadcn 组合式原子件：保留 shadcn 原名，C 端不再起 Surface / EmptyState 等别名。 */
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from '~/admin-ui/components/ui/card';
export { Badge } from '~/admin-ui/components/ui/badge';
export {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '~/admin-ui/components/ui/empty';
export {
  Alert,
  AlertTitle,
  AlertDescription,
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '~/admin-ui/components/ui/tabs';
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
