import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui';

export function ExpandTextModal({
  open,
  title,
  value,
  maxLength,
  placeholder,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  value: string;
  maxLength: number;
  placeholder: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <textarea
          className="pk-expand-textarea u-py-8 u-px-12 u-font-14"
          rows={10}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onClose}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
