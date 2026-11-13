/**
 * 共享 hook 入口。外部（页面 / 组件）从这里取件，目录内文件按 `./X` 互引。
 * 上下文 hook（`useAuth` / `useAdmin` / `useCredits`）随 provider 留在 `context/`。
 */

export { useAigcLabel } from './useAigcLabel';
export { useAdminAlerts } from './useAdminAlerts';
export { useAssetLibrary, type UseAssetLibraryResult } from './useAssetLibrary';
export { lockBodyScroll, useBodyScrollLock } from './useBodyScrollLock';
export { useCampaignCountdown, type CampaignCountdownParts } from './useCampaignCountdown';
export { useCapabilities, type UseCapabilitiesResult } from './useCapabilities';
export { useCapabilityRuntime, type CapabilityRuntimeState } from './useCapabilityRuntime';
export { useCreditCost, useCreditLabel } from './useCreditLabel';
export { useDeleteGalleryItem } from './useDeleteGalleryItem';
export { useDocumentMeta } from './useDocumentMeta';
export { useGenerateError } from './useGenerateError';
export { useGenerationSettings, type PlatformPreset } from './useGenerationSettings';
export { useIdempotencyKey } from './useIdempotencyKey';
export { useImageToPromptAnalysis } from './useImageToPromptAnalysis';
export { useImageUpload, type UploadedImage } from './useImageUpload';
export { useModelQuoteCreditLabel } from './useModelQuoteCreditLabel';
export { useIsMobile } from './use-mobile';
export { useLightboxIndex } from './useLightboxIndex';
export { mediaHeightRatio, useMasonryColumns } from './useMasonryColumns';
export { useMediaQuery } from './useMediaQuery';
export { usePasteUpload } from './usePasteUpload';
export { useTargetedAssetPicker } from './useTargetedAssetPicker';
export { usePollAbort } from './usePollAbort';
export { useProject } from './useProject';
export {
  hasActiveGalleryItems,
  useResultGallery,
  type GalleryItem,
  type ResultGallery,
} from './useResultGallery';
export { useRightTab, type RightTab } from './useRightTab';
export { useTaskPoller } from './useTaskPoller';
export { useToolHistory, type ToolHistoryTask } from './useToolHistory';
export { useToolTask } from './useToolTask';
export { useDiscardConfirm, useUnsavedGuard } from './useUnsavedGuard';
