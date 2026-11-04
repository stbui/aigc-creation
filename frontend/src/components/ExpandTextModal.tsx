import { Modal } from '../ui';

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
    <Modal open={open} title={title} okText="确定" cancelText="取消" onOk={onClose} onCancel={onClose}>
      <textarea
        className="pk-expand-textarea"
        rows={10}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Modal>
  );
}
