# 衣帽间功能策划（货觉AI · AI 模特试衣场景）

> 状态：规划中（策划草案 v0.1）｜ 日期：2026-11-15
> 归属假设：货觉AI（MVP 阶段，B 端商家工具）。若实际为「个人衣帽间（C 端社交）」或「manga-drama 角色服装库」，需重定向数据模型与试衣场景。

---

## 0. 结论摘要（先给结论）

1. **定位**：衣帽间 = 「商品衣物资产管理 + AI 模特试衣出图」模块，服务服饰/鞋包/首饰商家的“零成本棚拍替代”。
2. **技术基线**：2D AI 试衣（换装合成）。但主流开源试衣模型（CatVTON / IDM-VTON / OOTDiffusion）**仅覆盖上装/下装/连衣裙**。
3. **最大风险点**：你点名的全品类（衣服/裤子/袜子/鞋子/首饰/包包）里，**袜子/鞋子/首饰/包包属于“配饰”，主流开源换装模型不支持**。要全品类覆盖，必须接入支持配饰的生产级 API（如 FASHN Try-On Max）或自研/授权配饰模型。这是本功能最关键的技术与合规决策。
4. **授权红线**：CatVTON / IDM-VTON / OOTDiffusion 全部为 `CC BY-NC-SA`（**禁止商用**）。商用产品里唯一可自托管的开源换装模型是 **FASHN VTON v1.5（Apache-2.0，仅衣裤裙）**，配饰仍需 API 或授权。
5. **推荐路线**：MVP 走 **API 优先 + 模型网关 fallback**，复用 manga-drama 既有 model gateway fallback 设计；预留自托管路线作为成本可控化路径。

---

## 1. 市场与竞品调研

### 1.1 竞品矩阵

| 平台 | 技术路线 | 覆盖品类 | 核心能力 | 明显短板 |
|---|---|---|---|---|
| 淘宝 Lookie AI | 数字分身 LoRA | 服装为主 | 电子衣橱、多场景试穿、跨店搭配 | 亚洲体型偏差约 3cm、色彩映射失真、依赖多图训练 |
| 淘宝 AI 试穿 | 扩散换装 | 单品服装 | 搜索商卡入口、换装快、跨店搭配 | 标准身材模板、仅正面全身照、无虚拟形象定制 |
| 得物 魔镜 | AR + 3D 陀螺仪 | 球鞋/潮服/美妆/配饰 | 实时试穿、720° 查看、日活千万、退货率降约 30% | 偏 C 端潮品、商家难自主上传 |
| 京东 Oxygen Tryon | Flux-Fill + Redux | 平台自营 | 同店组合、约 7s 生成、手动体型 | 仅同店商品、动态动作适配有限 |
| Google Shopping Try On | Gemini 2.5 / Nano Banana | 全量服饰 | 跨端、高真实 | 仅美国、叠穿弱 |
| 豆包 / Kimi 搭配顾问 | LLM 规则推理 | 文字建议 | 场景化推理（天气/日程） | 无法识别主观偏好 |

### 1.2 关键洞察

- **痛点共识**：标准身材模板失真、色彩还原失真、对照片角度/姿势要求高、跨品牌混搭受限。
- **品类缺口**：鞋 / 包 / 首饰 / 袜子四类“配饰”在主流试衣工具里普遍缺失或弱（得物仅球鞋/手表/墨镜；淘宝京东主服装）。**这正是“衣帽间”的差异化机会点**——把六类都做全。
- **商业价值**：传统季度拍摄成本数万，AI 出图成本近零、收费为传统 1/3~1/10；得物 AR 试穿使鞋服退货率降约 30%。

---

## 2. 开源技术选型

### 2.1 模型对比（截至 2026-10）

| 模型 | 许可 | 商用 | 显存 | 速度 | 质量/特长 | 配饰支持 |
|---|---|---|---|---|---|---|
| CatVTON | CC BY-NC-SA | ❌ | ~8GB | 最快（~11s/A100） | 衣物形状最佳、轻量 899M | ❌（仅衣裤裙） |
| IDM-VTON | CC BY-NC-SA | ❌ | ≥16GB | ~17s | 纹理/色彩最真 | ❌ |
| OOTDiffusion | CC BY-NC-SA | ❌ | 高 | ~46s | 可控姿态、自动 mask | 仅上/下/裙 |
| Leffa | MIT（数据 NC） | ⚠️ 灰 | — | — | 姿态迁移 | ❌ |
| FASHN VTON v1.5 | Apache-2.0 | ✅ | ~8GB / 2GB 权重 | — | 生产级、mask-free、衣裤裙 | ❌（仅衣裤裙） |
| OmniTry | Apache-2.0 LoRA on NC base | ❌ | — | — | 配饰/首饰专训 | ✅（研究） |
| Qwen-Image-Edit + LoRA | Apache-2.0 | ✅ | — | — | 通用编辑器带试衣 | 部分 |
| FASHN Try-On Max（API） | 商用付费 | ✅ | 无（托管） | 秒级 | 衣+鞋+包+首饰 全品类、4K | ✅ |

### 2.2 选型结论

- **开源 ≠ 可商用**。CatVTON / IDM-VTON / OOTDiffusion 全部禁止商用，产品里不能直接用。
- **全品类（含配饰）商用可行路线二选一**：
  - **A（推荐·快）**：生产级 API（FASHN Try-On Max 等），按次计费约 $0.4~1.12/次，覆盖衣+鞋+包+首饰，零 GPU 运维。
  - **B（重·可控）**：自托管 FASHN v1.5（衣裤裙，Apache-2.0）+ 配饰模型授权/自训（OmniTry 不可商用需授权）。
- **结论**：MVP 走 **A（API 优先 + 模型网关 fallback）**，复用 manga-drama 既有 model gateway fallback；预留 B 作为成本可控化路径。

---

## 3. 产品定义

### 3.1 定位与价值

- **一句话**：商家把衣服/裤子/袜子/鞋子/首饰/包包“入库”，选模特+场景，一键生成可商用的模特上身/搭配图，替代棚拍。
- **目标用户**：服饰/鞋包/首饰中小商家、带货达人、独立设计师。
- **核心价值**：降本（零棚拍）、提速（分钟级出图）、**全品类覆盖**（差异化于竞品只做服装）。

### 3.2 核心模块

1. **衣帽间资产库（Wardrobe）**：按品类管理衣物资产（平铺图/上身图/属性）。
2. **模特与场景预设（Model & Scene）**：体型/肤色/发型/姿态 + 背景场景模板。
3. **试衣搭配台（Try-On Studio）**：从衣帽间拖选多件（上衣+下装+鞋+包+首饰），生成搭配。
4. **出图与导出（Export）**：批量生成、4K 导出、套图/详情页模板。

### 3.3 品类数据模型（关键）

品类枚举需覆盖你点名的全部：衣服 `TOP` / 裤子 `BOTTOM` / 袜子 `SOCKS` / 鞋子 `SHOES` / 首饰 `JEWELRY` / 包包 `BAG`，并预留连衣裙 `DRESS` / 外套 `OUTER` / 帽子 `HAT` / 配饰 `ACCESSORY`。

- 每件资产：品类、名称、品牌、颜色、尺码、材质、标签、图片（平铺/上身）、来源（上传/AI 生成）、状态。
- **关键字段**：`garmentType`（决定试衣模型调用参数：upper/lower/dress/auto）、`isAccessory`（配饰走专用模型/API 通道）。这是全品类试衣能否路由正确的核心。

### 3.4 用户旅程

上传衣物平铺图 → 入库打标 → 进入搭配台 → 选模特+场景 → 勾选多件（含鞋包首饰）→ 生成 → 预览/微调 → 批量导出商品图。

---

## 4. UX 设计

### 4.1 信息架构

```
衣帽间（左侧：品类导航 + 资产网格）
   │
搭配台（中央画布：模特 + 已选衣物缩略）
   │
右侧面板：模特预设 / 场景模板 / 试衣参数
   │
底部：出图队列 + 结果画廊
```

### 4.2 关键流程

- **入库流程**：拖拽上传 → 自动识别品类（或手动）→ 填属性/标签 → 存为资产。
- **试衣流程**：选模特预设 → 从衣帽间勾选衣物（支持多件叠加）→ 选场景背景 → 点“生成” → 异步队列 → 结果画廊。

### 4.3 试衣场景展示交互

- **模特预设卡**：多种体型/肤色/发型，解决竞品“标准身材模板失真”痛点（P3 引入数字分身）。
- **场景模板**：纯色 / 街拍 / 棚拍 / 生活化。
- **多件试衣“分层叠加”**：先衣裤，再鞋包首饰（配饰走独立通道，因模型不同）。
- **异步必做**：扩散模型 15~45s/张，必须异步 + 进度 + 通知（竞品教训：不可实时）。

---

## 5. 技术设计（贴合现有 AIGC 栈）

### 5.1 架构

```
Frontend (React 19 + Vite 8 + 旧版 UI 库 + Tailwind v4)
   │
NestJS 12 (Prisma 7 + PostgreSQL)
   │
TryOnService（模型网关，复用 manga-drama model gateway fallback）
   ├─ FASHN Try-On Max API（主：全品类，含配饰）
   ├─ FASHN v1.5 自托管（fallback：衣裤裙，Apache-2.0）
   └─ 配饰模型（鞋/包/首饰/袜子，API 或授权模型）
```

- 任务异步化：队列 + WebSocket/轮询进度（扩散 15~45s）。
- 成本计量：API 按次计费，记录 `cost`、做预算/配额。

### 5.2 数据模型草案（Prisma）

```prisma
model WardrobeAsset {
  id          String   @id @default(cuid())
  ownerId     String
  category    String   // TOP/BOTTOM/SOCKS/SHOES/JEWELRY/BAG/DRESS/OUTER/HAT/ACCESSORY
  name        String
  brand       String?
  color       String?
  size        String?
  material    String?
  tags        String[]
  images      Json      // 平铺图 / 上身图
  source      String    // upload | ai_generated
  status      String
  garmentType String    // upper | lower | dress | auto（试衣路由参数）
  isAccessory Boolean   // true=配饰，走专用模型/API
  createdAt   DateTime  @default(now())
}

model TryOnScene {
  id           String   @id @default(cuid())
  ownerId      String
  modelPreset  Json     // 体型/肤色/发型/姿态
  scenePreset  String   // 背景场景模板
  assetIds     String[] // 多件叠加
  background   String?
  createdAt    DateTime @default(now())
}

model TryOnTask {
  id        String   @id @default(cuid())
  sceneId   String
  status    String   // QUEUED | RUNNING | SUCCESS | FAILED
  model     String   // 实际调用的模型/API
  inputs    Json
  resultUrl String?
  cost      Float?
  createdAt DateTime @default(now())
}
```

### 5.3 集成要点

- **试衣服务抽象层**：统一接口 `tryOn(personImg, garmentImg, category)`，按 `garmentType` / `isAccessory` 路由到正确模型/API，含 fallback。
- **异步任务**：扩散模型 15~45s，必须入队、限流、结果回调。
- **合规校验**：非 Apache-2.0 模型禁止上线（授权红线）。

---

## 6. MVP 拆分（建议分批）

- **P0**：衣帽间资产库（上传/品类/属性）+ 试衣服务抽象层 + 单件服装试衣（FASHN v1.5 自托管或 API）。
- **P1**：模特预设 + 场景模板 + 多件搭配（衣裤）+ 异步队列 + 出图导出。
- **P2**：配饰全品类（鞋/包/首饰/袜子）接入生产 API + 批量套图模板。
- **P3**：虚拟形象/数字分身（降体型失真）、色彩校准、跨店搭配推荐。

---

## 7. 风险与开放问题

- **R1 授权（最高优先级）**：开源换装模型禁商用，配饰商用需 API 或授权。
- **R2 配饰质量**：鞋子/包/首饰试衣是行业难点，开源基本不支持，效果与成本需实测。
- **R3 体型/色彩失真**：竞品通病，建议 P3 引入数字分身 + 色彩校准。
- **R4 成本**：API 按次计费，需定价/配额策略。
- **Q1**：是 C 端“个人衣帽间+社交”，还是纯 B 端商家工具？（当前按 B 端假设）
- **Q2**：模特图来源——内置模特库 vs 用户上传真人模特？

---

## 8. 下一步

1. **决策**：确认 B 端定位 + API 优先路线。
2. **实测**：用 FASHN Try-On Max / v1.5 跑一轮“衣服+裤子+鞋子+包+首饰”六类样例，验证配饰可用性。
3. **原型**：在货觉AI（MVP 阶段）内搭「衣帽间资产库 + 搭配台」高保真原型。
