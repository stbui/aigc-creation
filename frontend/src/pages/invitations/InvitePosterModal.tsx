import { Download } from 'lucide-react';

import { Button, Modal } from './components';

interface InvitePosterModalProps {
  open: boolean;
  posterUrl: string | null;
  onClose: () => void;
  onDownload: () => void;
}

/** 邀请海报预览与下载；海报由 `utils.buildInvitePoster` 在本地合成。 */
export function InvitePosterModal({ open, posterUrl, onClose, onDownload }: InvitePosterModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={420}
      centered
      title="邀请海报"
      destroyOnHidden
    >
      {posterUrl && <img src={posterUrl} alt="邀请海报" className="invite-poster-image" />}
      <Button
        type="primary"
        block
        icon={<Download size={15} />}
        className="invite-poster-download"
        onClick={onDownload}
      >
        下载海报
      </Button>
      <p className="invite-poster-note">海报含你的专属邀请码，好友扫码注册后自动绑定邀请关系。</p>
    </Modal>
  );
}
