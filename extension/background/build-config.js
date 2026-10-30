/**
 * 构建档位。
 *
 * 工作区源码恒为 `development`：对接本机 `./start.sh` 起的前端
 * （http://localhost:5100，Vite 已把 /api 与 /uploads 代理到 4100）。
 *
 * 发布包在打包脚本的临时目录里把这一个字段改成 `"production"`，
 * 且必须先在 `environment.js` 填好 `PRODUCTION_FRONTEND_ORIGIN` ——
 * 那里是占位域名，留着占位值会在加载期直接报错（见 environment.js）。
 */
export const HUOJUE_BUILD_CONFIG = Object.freeze({
  environment: "development"
});
