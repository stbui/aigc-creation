import { Download } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './components';

interface InvitePosterModalProps {
  open: boolean;
  posterUrl: string | null;
  onClose: () => void;
  onDownload: () => void;
}

/** 邀请海报预览与下载；海报由 `utils.buildInvitePoster` 在本地合成。 */
export function InvitePosterModal({ open, posterUrl, onClose, onDownload }: InvitePosterModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-4 p-6 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>邀请海报</DialogTitle>
        </DialogHeader>
        {posterUrl && (
          <img
            src={posterUrl}
            alt="邀请海报"
            className="block w-full rounded-lg border border-border"
          />
        )}
        <Button
          variant="default"
          className="mt-4 h-10 w-full justify-center"
          onClick={onDownload}
        >
          {<Download size={15} />}
          下载海报
        </Button>
        <p className="mt-2.5 mb-0 text-center text-xs leading-[18px] text-muted-foreground">
          海报含你的专属邀请码，好友扫码注册后自动绑定邀请关系。
        </p>
      </DialogContent>
    </Dialog>
  );
}
