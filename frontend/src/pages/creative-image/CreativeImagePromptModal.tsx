import { CREATION_PROMPT_PLACEHOLDER, MAX_PROMPT_LEN } from './constants';
import { Modal } from '../../ui';

interface CreativeImagePromptModalProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

/** 创作提示词放大编辑弹窗；打开状态与文案由页面持有。 */
export function CreativeImagePromptModal({ open, value, onChange, onClose }: CreativeImagePromptModalProps) {
  return (
    <Modal
      open={open}
      title="编辑创作提示词"
      okText="确定"
      cancelText="取消"
      onOk={onClose}
      onCancel={onClose}
    >
      <textarea
        className="pk-expand-textarea"
        rows={10}
        maxLength={MAX_PROMPT_LEN}
        value={value}
        placeholder={CREATION_PROMPT_PLACEHOLDER}
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}
