/** 图片上传区的纯数据契约；由页面 / hook 持有，组件只读。 */

export interface ImageUploadItem {
  id: string;
  url: string;
  name: string;
  /** 网格缩略图；缺省回退 `url` */
  thumbUrl?: string;
}

/**
 * 空态、缩略图与已选区自定义渲染时拿到的操作入口。
 *
 * `open` 不受数量上限拦截（单图工具的「重新上传」要在已满时仍然能开框）；
 * 上传区自身的点击只在还有空位时开框。
 */
export interface ImageUploadControls {
  open: () => void;
  remove: (id: string) => void;
  preview: (item: ImageUploadItem) => void;
  uploading: boolean;
  disabled: boolean;
}
