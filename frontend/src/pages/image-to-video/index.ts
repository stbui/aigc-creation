/**
 * 图生视频页面入口。
 *
 * `App.tsx` 以精确路径 `/tools/image_to_video` 懒加载本页；该路径必须放在
 * `/tools/:capability` 之前，避免通用 ToolPage 在能力无线路时整页替换成异常页。
 */
import './style.css';
export { ImageToVideoPage } from './page';
