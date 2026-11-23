import { Spinner } from '~/admin-ui/components/ui/spinner';

/** 上传中的遮罩；由上传区负责定位（绝对铺满外层命中区）。 */
export function ImageUploadLoading() {
  return (
    <div
      data-slot="image-upload-loading"
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-10 grid place-items-center rounded-md bg-background/70 backdrop-blur-[1px]"
    >
      <Spinner className="size-4" aria-hidden />
      <span className="sr-only">上传中，请稍候</span>
    </div>
  );
}
