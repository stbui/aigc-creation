/**
 * 提示词库目录的对外出口。
 *
 * 外部（后台路由、测试）只从 `./prompts` 取页面；目录内的组件、接口、
 * hook、工具与常量分别经各入口文件取用。分层约定见
 * `docs/frontend-module-conventions.md`。
 */
import '../../../styles/radar-admin.css';
export { AdminPromptsPage } from './page';
