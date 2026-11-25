# 货觉AI

面向电商团队的智能视觉创作平台。上传商品图或输入提示词，即可生成可上架的商品主图、详情图、修图结果与短视频。

所有创作结果都来自真实模型线路；没有可用线路时任务失败并退款，不使用本地占位图或伪模型结果。

## 能做什么

| 场景 | 能力 |
| --- | --- |
| 电商生图 | 商品主图、商品详情图、爆款复刻、多图融合、商品 SKU 图、AI 带货图文、写真模板 |
| AI 修图 | 局部重绘、智能扩图、一键抠图、去除水印、图片翻译、产品精修、商品换色、旋转角度 |
| AI 视频 | 图生视频，按模型协议异步轮询取回产物 |
| 创作与资产 | 自由创作、素材库、我的作品、数据中心 |
| 账户与商业 | 积分与套餐、订单与支付、退款、会员、工单 |
| 后台管理 | 渠道与模型、能力绑定与定价、任务与账单、用户与内容运营 |

## 技术架构

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite + shadcn/ui + Tailwind CSS |
| 后端 | NestJS + Prisma + SQLite |
| 模型链路 | 渠道 → 渠道模型 → 能力绑定 → 能力目录选路 → 任务执行 → 账单与退款 |
| 协议接入 | 内置模型协议插件，覆盖多家主流供应商；图像 / 文本同步，视频异步轮询 |
| 测试与联调 | Vitest + Playwright + 零依赖仿真模型网关 |

模型调用、能力定义、权限与账单各只有一条实现链路；后台可配置渠道、能力绑定和售价，运行期按健康度选路。

## 快速开始

前置：Node.js ≥ 22.12、npm、Redis（任务队列使用官方 `@nestjs/bullmq`；本机默认 `redis://127.0.0.1:6379`，也可用 `docker compose up -d redis`）。

```bash
npm run setup
./start.sh
```

启动后访问：

- 前端：<http://localhost:5100>
- API：<http://localhost:4100/api/v1>

常用命令：

```bash
./start.sh --env test    # 测试档，使用独立测试库
./start.sh --stop        # 停止后台服务
npm run check            # 构建、静态检查与单测
```

本地开发账号由种子配置决定；默认账号只用于开发环境，不要在生产环境使用默认凭据。

Docker 启动与生产部署见 [`docs/docker-deployment.md`](docs/docker-deployment.md)。

## 项目结构

| 目录 | 说明 |
| --- | --- |
| `backend/` | NestJS API、模型链路、任务与账单、后台接口 |
| `frontend/` | C 端页面与后台管理端 |
| `agent/` | AI 智能体子项目 |
| `extension/` | Chrome 图片采集扩展 |
| `test/` | 零依赖仿真模型网关，用于本地联调与失败注入 |
| `docs/` | 产品、技术、测试与规划文档 |

## 更多文档

- [产品需求](docs/prd.md)
- [后台需求](docs/admin-prd.md)
- [API 契约](docs/api-contract.md)
- [模型架构](docs/model-architecture.md)
- [支付域详细设计](docs/payment-detailed-design.md)
- [完整文档索引](docs/README.md)
