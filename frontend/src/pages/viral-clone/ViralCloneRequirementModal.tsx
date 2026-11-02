
import { MAX_REQUIREMENT_LEN } from './constants';
import { Modal } from '../../ui';

/** 复刻要求放大编辑弹窗。 */
export function ViralCloneRequirementModal({
  open,
  requirement,
  onRequirementChange,
  onClose,
}: {
  open: boolean;
  requirement: string;
  onRequirementChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="编辑复刻要求"
      okText="确定"
      cancelText="取消"
      onOk={onClose}
      onCancel={onClose}
    >
      <textarea
        className="pk-expand-textarea"
        rows={10}
        maxLength={MAX_REQUIREMENT_LEN}
        value={requirement}
        placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
        onChange={(e) => onRequirementChange(e.target.value)}
      />
    </Modal>
  );
}
