/**
 * shadcn/ui 组件出口。
 *
 * ## 为什么不直接引 `components/ui/xxx`
 *
 * 后台的目录分层约定（`docs/frontend-module-conventions.md`）要求：功能目录
 * （如 `pages/admin/channels/`）只从入口文件取外部控件，不直连外部目录。
 * 这个文件就是 shadcn 那一侧的入口。
 *
 * ## 与 BoardUI 的分工
 *
 * 两套组件并存、**按职责划分**，不重叠：
 *   - BoardUI vendor（`src/vendor/boardui`）—— 后台**已有**的表单控件、
 *     表格、页签等，改动成本高，保留；
 *   - shadcn（`src/admin-ui/components/ui`）—— 新写的后台页面用这一套，
 *     观感统一、源码自持。
 *
 * 两者共用同一份类名合并（`lib/cn`）与同一套设计令牌（`global.css` 的
 * `--brand` / `--text-strong` / `--border`），所以视觉上是一套。
 *
 * 注意 vendor 源码保持上游原样，**不要**为了配合 shadcn 去改 vendor。
 */

/* 基础件 */
export { Button, buttonVariants } from './button';
export { Input } from './input';
export { Textarea } from './textarea';
export { Label } from './label';
export { Badge, badgeVariants } from './badge';
export { Separator } from './separator';
export { Skeleton } from './skeleton';

/* 容器 */
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';

/* 表格 */
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

/* 浮层 */
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
} from './dialog';
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

/* 表单控件 */
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';
export { Checkbox } from './checkbox';
export { Switch } from './switch';
export { Progress } from './progress';

/* 导航 */
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './tabs';

/* 其它 */
export { Avatar, AvatarFallback, AvatarImage } from './avatar';
export { ScrollArea, ScrollBar } from './scroll-area';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';
