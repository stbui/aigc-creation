
import { MAX_DESC_LEN } from './constants';
import { Modal } from '../../ui';

/** 商品描述放大编辑弹窗；打开状态与文案仍由页面持有。 */
export function ProductKitDescriptionModal({
  open,
  description,
  onChange,
  onClose,
}: {
  open: boolean;
  description: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="编辑商品描述"
      okText="确定"
      cancelText="取消"
      onOk={onClose}
      onCancel={onClose}
    >
      <textarea
        className="pk-expand-textarea"
        rows={10}
        maxLength={MAX_DESC_LEN}
        value={description}
        placeholder="* 请输入商品描述"
        onChange={(e) => onChange(e.target.value)}
      />
    </Modal>
  );
}
