
import { MAX_REQUIREMENT_LEN, REQUIREMENT_PLACEHOLDER } from './constants';
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
        placeholder={REQUIREMENT_PLACEHOLDER}
        onChange={(e) => onRequirementChange(e.target.value)}
      />
    </Modal>
  );
}
