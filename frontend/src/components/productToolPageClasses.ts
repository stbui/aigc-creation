/**
 * 产品系工具页（翻译 / 精修 / 换色 / 旋转 / 扩图）的共享骨架皮肤。
 *
 * 这五页共用同一套三栏骨架与上传态，差异只在业务卡。此前差异写在一张
 * 页面级样式表里，用 `.pk-workspace.product-retouch-page` 提升特异性；
 * 现在作为 `pageClass` / `UploadSpec.dropzoneClassName` 传入，由 Tailwind
 * 工具类表达，不再依赖某个路由的样式表是否已加载。
 *
 * 骨架内侧元素（`SectionCard` / `.pk-submit-actions` 等）不接受页面重写结构，
 * 只用 `[&_.x]` / `[&_[data-slot=…]]` 变体调尺寸；断点变体写在元素变体之前
 * （`max-[900px]:[&_.x]:…`），避免任意变体嵌套造成无效选择器。
 */

const PAGE_ROOT = [
  // 根节点：高度取「视口减外壳」，铺满而不是被内容撑开
  'box-border h-[calc(100vh_-_var(--workspace-topbar-height))]! min-h-[calc(100vh_-_var(--workspace-topbar-height))]! max-h-none',
  'py-4! px-4! gap-4! items-stretch! overflow-hidden! grid-rows-[minmax(0,1fr)]!',
  'bg-[var(--page-bg)] text-[color:var(--tool-text-1)]!',
  // 栅格：432 / 1fr / 192；1366 收窄，1180 收起历史列，900 单列
  'grid-cols-[432px_minmax(0,1fr)_192px]!',
  'min-[1181px]:max-[1366px]:grid-cols-[minmax(340px,420px)_minmax(0,1fr)_192px]! min-[1181px]:max-[1366px]:gap-3!',
  'min-[901px]:max-[1180px]:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]!',
  // 收起历史：宽屏释放第三列，1366 档左栏收成 216
  '[&.pk-workspace-trailing-collapsed]:grid-cols-[432px_minmax(0,1fr)]!',
  'min-[901px]:max-[1366px]:[&.pk-workspace-trailing-collapsed]:grid-cols-[216px_minmax(0,1fr)]!',
  'max-[900px]:[&.pk-workspace-trailing-collapsed]:grid-cols-1!',
].join(' ');

const PAGE_INNER = [
  // 左右两栏铺满轨道（骨架默认把左栏钉在 432）
  '[&_.pk-input-pane]:w-full! [&_.pk-input-pane]:h-full! [&_.pk-input-pane]:min-h-0!',
  'min-[901px]:[&_.pk-input-pane]:pr-1!',
  '[&_.pk-result-pane]:w-full! [&_.pk-result-pane]:h-full! [&_.pk-result-pane]:min-h-0!',
  // 卡片内容间距 / 提交区比骨架紧一档（卡片本身的 p-4 与 16px 圆角已是默认）
  '[&_[data-slot=section-card-content]]:gap-3!',
  '[&_.pk-submit-actions]:pt-3.5! [&_.pk-submit-actions]:px-4! [&_.pk-submit-actions]:pb-4! [&_.pk-submit-actions]:gap-3.5!',
  '[&_.pk-primary-btn]:h-[34px]!',
  '[&_.pk-form-scroll]:gap-3!',
  'min-[901px]:[&_.pk-form-scroll]:gap-2.5!',
  // 空态：透明底 + 480 方框，标题描述各降一档
  '[&_.pk-preview-placeholder]:bg-transparent! [&_.pk-preview-placeholder]:rounded-none!',
  '[&_.pk-preview-inner]:w-full! [&_.pk-preview-inner]:min-h-0! [&_.pk-preview-inner]:p-0! [&_.pk-preview-inner]:gap-0!',
  '[&_.pk-empty-illustration]:w-[480px]! [&_.pk-empty-illustration]:max-w-[calc(100%_-_48px)]! [&_.pk-empty-illustration]:aspect-square! [&_.pk-empty-illustration]:bg-[var(--surface-2)]!',
  '[&_.pk-preview-inner_h3]:mt-8! [&_.pk-preview-inner_h3]:mb-2! [&_.pk-preview-inner_h3]:text-sm! [&_.pk-preview-inner_h3]:leading-5!',
  '[&_.pk-preview-inner_p]:text-xs! [&_.pk-preview-inner_p]:leading-5!',
  '[&_.pk-result-pane-editor]:bg-transparent!',
  // 1366：上传卡标题行与说明收一档
  'min-[1181px]:max-[1366px]:[&_[data-slot=image-upload-header]_strong]:text-xs!',
  'min-[1181px]:max-[1366px]:[&_[data-slot=image-upload-header]]:gap-1!',
  'min-[1181px]:max-[1366px]:[&_[data-slot=image-upload-actions]]:gap-1!',
].join(' ');

const PAGE_MOBILE = [
  'max-[900px]:grid-cols-1! max-[900px]:grid-rows-[auto]! max-[900px]:content-start',
  'max-[900px]:h-auto! max-[900px]:min-h-0! max-[900px]:max-h-none',
  'max-[900px]:-mx-2.5! max-[900px]:-mt-4! max-[900px]:-mb-6!',
  'max-[900px]:p-2.5! max-[900px]:gap-2.5! max-[900px]:overflow-visible!',
  'max-[900px]:[&_.pk-input-pane]:block! max-[900px]:[&_.pk-input-pane]:w-full! max-[900px]:[&_.pk-input-pane]:h-max!',
  'max-[900px]:[&_.pk-input-pane]:min-h-0! max-[900px]:[&_.pk-input-pane]:pr-0!',
  'max-[900px]:[&_.pk-form-card]:block! max-[900px]:[&_.pk-form-card]:h-auto!',
  'max-[900px]:[&_.pk-form-scroll]:grid! max-[900px]:[&_.pk-form-scroll]:flex-none! max-[900px]:[&_.pk-form-scroll]:overflow-visible! max-[900px]:[&_.pk-form-scroll]:mb-3!',
  'max-[900px]:[&_.pk-result-pane]:h-auto! max-[900px]:[&_.pk-result-pane]:min-h-[720px]!',
  'max-[900px]:[&_[data-slot=section-card]]:p-3.5!',
  'max-[900px]:[&_[data-slot=section-card-content]]:gap-2.5!',
  'max-[900px]:[&_.pk-submit-actions]:pt-3! max-[900px]:[&_.pk-submit-actions]:px-3.5! max-[900px]:[&_.pk-submit-actions]:pb-3.5!',
  'max-[900px]:[&_.pk-primary-btn]:h-10!',
].join(' ');

/** 产品系五页共用的页面根类 */
export const PRODUCT_TOOL_PAGE = `${PAGE_ROOT} ${PAGE_INNER} ${PAGE_MOBILE}`;

/**
 * 上传区：参考站底色 #f6f7f9 / 虚线边 #d9dee8；有图后不再保留虚线框，
 * 而是 160px 高的居中预览（`productSourceUploadPreview` 自带 160×160 缩略图）。
 * 选择器挂在 `ImageUploadArea` 的 `data-slot` / `data-*` 状态槽位上，不依赖页面 class。
 */
export const PRODUCT_TOOL_DROPZONE = [
  'bg-[var(--surface-5)]! border-[var(--tool-border-4)]! p-0! gap-2!',
  'max-[900px]:p-4!',
  '[&>[data-slot=image-upload-prompt]]:w-full [&>[data-slot=image-upload-prompt]]:min-h-0 [&>[data-slot=image-upload-prompt]]:gap-2',
  '[&_[data-slot=image-upload-thumbs][data-single]]:w-40! [&_[data-slot=image-upload-thumbs][data-single]]:max-w-full!',
  'max-[900px]:[&_[data-slot=image-upload-thumbs][data-single]]:w-[min(160px,100%)]!',
  '[&[data-filled]]:flex! [&[data-filled]]:h-40! [&[data-filled]]:min-h-40!',
  '[&[data-filled]]:items-center! [&[data-filled]]:justify-center!',
  '[&[data-filled]]:cursor-default! [&[data-filled]]:border-0! [&[data-filled]]:rounded-none!',
  '[&[data-filled]]:bg-transparent! [&[data-filled]]:shadow-none!',
  '[&[data-filled]]:hover:border-0! [&[data-filled]]:hover:bg-transparent! [&[data-filled]]:hover:ring-0!',
  'min-[901px]:max-[1366px]:[&[data-filled]]:h-auto! min-[901px]:max-[1366px]:[&[data-filled]]:min-h-40!',
].join(' ');
