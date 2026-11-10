# 货觉AI 图片采集（浏览器扩展）

Chrome MV3 扩展：在电商 / 内容站点上悬停或右键图片，一键采集到货觉AI的素材库，并可跳到「图片复刻」以该图为参考图开生成任务。

前端与后端都在本仓库内（`frontend/` + `backend/`），扩展不依赖任何第三方服务，只调用本站 `/api/v1`。

## 落点映射

扩展没有自己的数据模型，全部落在本站已有实体上：

| 扩展概念 | 本站实体 | 说明 |
| --- | --- | --- |
| 分组 | 项目 `Project` | 读写 `GET /projects`、`POST /projects`，分组保存走 `PATCH /assets/move` |
| 采集的图片 | 素材 `Asset`（`kind=original`） | `POST /assets/upload`（multipart，带 `projectId`） |
| 来源站点 / 标题 / 商品页 | `Asset.sourceSite` / `sourceTitle` / `sourcePageUrl` | 采集时随表单一起提交，素材库卡片上展示可点击的来源 |
| 「查看我的素材」 | `/asset-library?projectId=` | 带上刚采集的分组 |
| 「图片复刻」 | `/viral-clone?referenceAssetId=` | 先把图存进素材库，再把素材 id 作为参考图带过去 |

登录态借本站的：令牌是前端 `localStorage` 的 `huojue_token`（`frontend/src/lib/auth.ts`），由 `content/auth-monitor.js` 转发给 Service Worker，只存 `chrome.storage.session`，浏览器关闭即失效。

## 目录

```
manifest.json                 MV3 清单（权限 / 内容脚本注入范围 / WAR）
background/
  service-worker.js           消息总线：采集、复刻、分组、右键菜单、登录引导
  environment.js              站点地址与档位解析（本地内存里的改写点）
  build-config.js             构建档位：development / production
  api-client.js               JSON 与 multipart 请求，拆 {code,data,message} 信封
  user-session.js             取令牌（三级回退）、登录页、登录态广播
  user-info-service.js        GET /me
  project-service.js          项目列表 / 新建 / 决定落点分组 / 批量移动
  asset-uploader.js           下载 → 归一化 → 上传 → 返回素材信息
  image-normalizer.js         格式与体积归一化（对齐后端上传校验）
  animated-image.js           动图冻结首帧
  debug-log.js                统一日志前缀 [HuojueCapture]
content/
  image-hover.js              悬停操作条 / 多选批量 / 采集结果弹层
  image-candidate-filter.js   判断哪个 <img> 值得采集
  auth-monitor.js             本站页面上报登录态（只注入本站）
popup/                        账号信息、站点开关、入口按钮
_locales/                     8 种语言文案
assets/                       扩展图标
```

## 本地运行

1. 起站点：仓库根目录 `./start.sh`（前端 `http://localhost:5100`，后端 4100，Vite 已代理 `/api` 与 `/uploads`）。
2. Chrome → `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选本目录。
3. 在任意 HTTP/HTTPS 页面悬停图片，或右键图片选择「保存至货觉AI」。
4. 首次采集会提示登录，登录页在新标签页打开，登录成功后原页面会收到通知并允许重试。

## 环境档位

`background/build-config.js` 的 `environment` 恒为 `development`（对接 `localhost:5100`）。发布生产包要改两处，缺一不可：

1. `background/environment.js` 的 `PRODUCTION_FRONTEND_ORIGIN` 填真实域名。仍是占位值时，生产档在加载期直接抛错 —— 不会静默退化成 localhost。
2. `manifest.json` 里 `https://your-domain.com/*` 出现在三处：第一个内容脚本的 `exclude_matches`（本站页面不注入采集 UI）与第二个内容脚本的 `matches`（本站页面注入登录监听）。

## 消息契约

Service Worker 侧的类型与载荷（content / popup → SW）：

| type | 载荷 | 返回 |
| --- | --- | --- |
| `huojue:capture-image` | `imageUrl` `projectId?` `sourceTitle?` `sourcePageUrl?` | `assetId` `url` `projectId` `projectName` |
| `huojue:replicate-image` | `imageUrl` | `assetId` `url` `targetUrl` |
| `huojue:get-user-info` | — | `user` |
| `huojue:get-projects` | `openLoginOnRequired?` | `projects` `selectedProject` |
| `huojue:create-project` | `name` | `project` |
| `huojue:move-assets` | `assetIds` `projectId` | `result` |
| `huojue:open-login` | — | `loginUrl` |
| `huojue:open-page` | `page`(`library`\|`workbench`\|`login`) `projectId?` | `targetUrl` |
| `huojue:auth-state` | `authenticated` `token`（仅本站页面） | `authenticated` `loggedOut` `userChanged` |

反向（SW → content）：`huojue:save-progress`、`huojue:save-result`、`huojue:get-context-menu-target`、`huojue:login-detected`、`huojue:logout-detected`。

`loginRequired: true` 表示本次失败是登录问题，页面据此把按钮换成「重新登录」。

登录引导的范围：采集 / 复刻 / 新建分组 / 移动分组这些**用户主动触发**的请求，未登录时 SW 会顺手打开登录页；`huojue:get-user-info` 永不打开；`huojue:get-projects` 默认打开，被动预取（弹窗初始化）必须传 `openLoginOnRequired: false`。

## 依赖的后端能力

- `POST /api/v1/assets/upload`：`file` + `projectId`（必填）+ 三个可选来源字段；仅 PNG / JPEG / WebP，≤10MB、≤4000 万像素。超出时由 `image-normalizer.js` 在扩展侧转码缩放；WebP 会先转成 PNG，避开后端 Jimp 对 WebP 解码能力的限制。
- `PATCH /api/v1/assets/move`：`{ids, projectId}`，一次最多 100 条。
- `GET /api/v1/projects`、`POST /api/v1/projects`、`GET /api/v1/me`。

## 限制

- `blob:` 图片无法采集：blob 属于页面上下文，Service Worker 下载不到；这类站点仍可复制图片地址。
- 需要登录才能写入：未登录时采集与复刻都会引导到 `/login`。
- 素材库地址在本地存储后端下是相对路径（`/uploads/...`），扩展用 `toAbsoluteUrl()` 补成站点绝对地址，否则在第三方页面上必然破图。
