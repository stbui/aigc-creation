/**
 * 手机上传页面的复用组件入口 —— 目录内文件的唯一外部组件来源。
 *
 * 本页是手机端独立落地页，视觉由页面独占样式决定；只复用与视觉无关的
 * 上传输入原子件（隐藏 input 与补位块），保证选图 / 清空 value 行为一致。
 */
export { ImageUploadAddTile, ImageUploadInput } from '../../ui';
