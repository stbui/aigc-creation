/** C 端 UI 唯一取用层。页面不直连 admin-ui 的原子件。 */
export { AppProvider, useApp, type AppApi, type ConfirmOptions } from './providers/AppProvider';
export { UiProvider } from './providers/UiProvider';

export { Button, type ButtonProps } from './primitives/button';
export { Input, type InputProps } from './primitives/input';
export { Select, type SelectProps, type SelectOption } from './primitives/select';
export { Checkbox, type CheckboxProps } from './primitives/checkbox';
export { Radio } from './primitives/radio';
export { Switch } from './primitives/switch';
export { Slider } from './primitives/slider';
export { InputNumber } from './primitives/input-number';
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
export { Form, FormItem, useForm, useWatch } from './primitives/form';
