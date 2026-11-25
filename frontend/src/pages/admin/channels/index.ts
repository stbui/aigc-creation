/**
 * 渠道工作台目录的对外出口。
 *
 * 外部（后台路由、测试）只从 `./channels` 取页面；目录内的业务组件、
 * 接口、hook、工具与常量分别经 `components.ts` / `api.ts` / `hooks.ts` /
 * `utils.ts` / `constants.ts` / `types.ts` 取用。分层约定见
 * `docs/design/standards/frontend-module-conventions.md`。
 *
 * 样式表只在此处引入一次：目录内 28 个文件原本各引一次，同一份 CSS 反复进入
 * 构建图，既拖慢拆分也说不清到底哪一层依赖了后台样式。
 */
import '../../../styles/radar-admin.css';
export { AdminChannelsPage } from './page';
