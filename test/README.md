# mock-model-gateway —— 仿真模型网关

一个**零依赖、纯 Node.js** 的本地模型网关：提供 OpenAI 标准协议的文生文 / 文生图 /
文生视频接口，以及本项目视频通道实际使用的 MiniMax 兼容接口。产物是**真实生成的
字节**（PNG / H.264 + MP4），但内容是按规则合成的仿真画面与模板文本。

它解决的问题：真实厂商不好按需制造「限流 / 5xx / 令牌失效 / 模型名不存在」，
配一个渠道要花钱、要等额度，失败路径几乎没法测。这个网关可以在本机把
「模型配置 → 测试 → 生成 → 下载 → 落库」整条链路的正反两条路都走通。

---

## 快速开始

```bash
cd test
node server.js        # 默认 http://127.0.0.1:3900
# 或
npm start
```

- 要求 **Node ≥ 22.5**，**没有任何第三方依赖**（不需要 `npm install`）。
- 默认只监听回环地址。需要给手机或容器联调时显式设置 `MOCK_HOST=0.0.0.0`。
- 默认不校验令牌（方便开箱即用）；设置 `MOCK_API_KEY` 后所有 `/v1/*` 请求都要带
  `Authorization: Bearer <MOCK_API_KEY>`。

启动后浏览器打开 `http://127.0.0.1:3900/` 可看到自描述的端点清单与运行参数。

---

## 接入本项目后台「模型配置」

后台「模型配置 → 线路管理」新建线路时按下表填。**基址只填根域，不要带 `/v1`**
（后端会把协议路径拼上去，多写一层 `/v1` 会 404 —— 这个网关也刻意对未知路径返回 404，
让配错能被「测试连接」识别出来）。

| 模态 | 协议 | 基址 | 推荐模型 | 说明 |
| --- | --- | --- | --- | --- |
| 文本 | `openai-chat` | `http://127.0.0.1:3900` | `gpt-4o` | 对话补全，也支持流式 |
| 图像 | `openai` | `http://127.0.0.1:3900` | `gpt-image-2` | 返回 `data[0].url` |
| 图像 | `minimax` | `http://127.0.0.1:3900` | `image-01` | `aspect_ratio` + `data.image_urls` |
| 视频 | `minimax-video` | `http://127.0.0.1:3900` | `MiniMax-Hailuo-2.3` | 项目当前唯一已实现的视频协议 |

令牌可以随便填（例如 `mock-token`）。只有设置了 `MOCK_API_KEY` 时，令牌必须与之
完全一致，否则「测试连接」会如实显示「令牌被拒绝 (HTTP 401)」。

「测试连接」的预期结果：

- 文本 / 图像线路：`连通正常 (HTTP 204) · 模型可用`。
- 视频线路：`连通正常 (HTTP 204) · 未验模型名` —— `minimax-video` 协议在
  `protocol.spec.ts` 里没有声明模型列表接口，后端只能验到网络可达。这是后端行为，
  不是网关缺接口。

`GET /v1/models` 返回 19 个内置模型名，覆盖本项目厂商预设里出现的名称
（`gpt-4o`、`gpt-image-2`、`image-01`、`doubao-seedream-5-0-pro-260628`、
`MiniMax-Hailuo-2.3` 等）。额外的名字用 `MOCK_MODELS=a,b,c` 追加。

---

## 接口

### 通用

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 自描述：端点、模型、运行参数、存储占用 |
| GET | `/health` | 健康检查 |
| GET | `/v1/models`、`/models` | 模型列表（OpenAI 形状 `{ object:'list', data:[{id,...}] }`） |
| GET | `/v1/models/:id` | 单个模型；未知 404 |
| GET | `/files/:id.ext` | 产物文件（图片 / 视频），支持单段 Range（206） |
| OPTIONS | 任意已实现路径 | 204 + `Allow`，供后台「测试连接」探活；未知路径 404 |

所有响应带 CORS 头（回显请求的 `Origin`），方便浏览器直连调试。

### 文生文

`POST /v1/chat/completions`

- 请求：`{ model, messages:[{role,content}], max_tokens?, temperature?, stream? }`
- 非流式响应：`{ id:'chatcmpl-…', object:'chat.completion', choices:[{ message:{ role:'assistant', content } }], usage }`
- 流式：`stream:true` 时返回 `text/event-stream`，逐块 `chat.completion.chunk`，
  末尾 `data: [DONE]`；带 `stream_options.include_usage` 时最后一块附 `usage`。
- 多模态：`content` 支持 `[{type:'text'},{type:'image_url'}]`，网关按图片数量返回
  「仿真识图」模板文本（不做真实视觉推理）。

### 文生图

`POST /v1/images/generations`（OpenAI 协议）

- 请求：`{ model, prompt, size:'WxH', n?, response_format?:'url'|'b64_json', seed?, image?/images? }`
- 响应：`{ created, data:[{ url } | { b64_json, revised_prompt }] }`
- `size` 支持 `64..2048`，总像素超过 `MOCK_IMAGE_MAX_PIXELS` 时等比缩小；
  `n` 限制 1–4。

`POST /v1/image_generation`（MiniMax 兼容）

- 请求：`{ model, prompt, aspect_ratio:'16:9', subject_reference?:[] }`
- 响应：`{ data:{ image_urls:[…] }, metadata, base_resp:{ status_code:0 } }`

### 文生视频

OpenAI 任务制：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/videos` | 创建任务（JSON，或带 `input_reference` 文件的 multipart），立即返回 `{ id, status:'queued'\|'in_progress', progress }` |
| GET | `/v1/videos/:id` | 查询；完成后 `status:'completed'`，并带 `mock_width` / `mock_height` |
| GET | `/v1/videos/:id/content` | 取 mp4；未就绪 409（`code:'video_not_ready'`），支持 Range |
| GET | `/v1/videos` | 任务列表 |
| DELETE | `/v1/videos/:id` | 删除任务与产物 |

MiniMax 四段式（本项目 `minimax-video` 协议实际走的链路）：

1. `POST /v1/video_generation` → `{ task_id, base_resp:{ status_code:0 } }`
2. `GET /v1/query/video_generation?task_id=` → `Queueing` / `Processing` / `Success`
   （成功时带 `file_id`、`video_width`、`video_height`；未知任务 `base_resp.status_code=2013`）
3. `GET /v1/files/retrieve?file_id=` → `{ file:{ download_url, bytes, filename, … } }`
4. `GET <download_url>` → mp4 字节

视频在创建任务时就已真实编码完成，状态推进只是按 `MOCK_VIDEO_READY_MS` 模拟时间，
这样轮询逻辑能被真实走到，又不会让创建请求阻塞几十秒。

---

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `MOCK_HOST` | `127.0.0.1` | 绑定地址（`0.0.0.0` 供局域网访问） |
| `MOCK_PORT` | `3900` | 端口，`0` 表示随机（测试用） |
| `MOCK_API_KEY` | 空 | 设置后 `/v1/*` 必须带 Bearer 令牌 |
| `MOCK_PUBLIC_BASE` | 空 | 产物 URL 的公开基址；默认按请求 Host 还原 |
| `MOCK_MODELS` | 空 | 逗号分隔的额外模型名，追加到 `/v1/models` |
| `MOCK_LATENCY_CHAT_MS` | `350` | 文本接口人为延迟 |
| `MOCK_LATENCY_IMAGE_MS` | `700` | 图像接口人为延迟 |
| `MOCK_VIDEO_READY_MS` | `2500` | 视频从创建到「完成」的模拟耗时 |
| `MOCK_FAIL_RATE` | `0` | 每次生成随机失败的概率（0–1，503） |
| `MOCK_FILE_TTL_MS` | `3600000` | 内存产物有效期（最少 60 秒） |
| `MOCK_MAX_STORE_MB` | `256` | 内存产物总容量上限（超出淘汰最老的） |
| `MOCK_VIDEO_MAX_SECONDS` | `6` | 单条视频最大秒数（1–30） |
| `MOCK_IMAGE_MAX_PIXELS` | `2400000` | 单张图片像素上限 |
| `MOCK_LOG_LEVEL` | `info` | `info` / `debug` / `quiet`（quiet 仅打错误） |
| `MOCK_TRUST_PROXY` | `false` | 为 `true` 时用 `X-Forwarded-Proto/Host` 拼产物 URL |

---

## 仿真边界

**文本**：规则模板合成，中英文各一套（主体 / 色彩 / 光影 / 构图 / 风格 / 负向提示词），
由 prompt 的 SHA-256 选模板，同输入稳定复现。输出开头显式标注「仿真」，不会让人
误以为是真实模型推理。

**图像**：真实 PNG 编码（自研编码器：IHDR/IDAT/IEND、逐 chunk CRC32、zlib 压缩）。
画面由 prompt 派生的配色 + 光斑 + 同心环 + 网格 + 底栏提示词组成；prompt 里点名的
颜色词（`purple` / `红` / `blue` / `金` 等，中英文都认）会决定主色。完整 prompt 写入
PNG 的 `tEXt`（`Comment`），真实模型名称写入 `Model`。
图像编辑端点 `POST /v1/images/edits` 同时接收 JSON 与 multipart 的 `image` 参考图字段，
用于联调「分镜图带参考图」链路。

**视频**：真实 H.264（I_PCM 宏块，无变换/量化）+ faststart MP4 封装，
`ffmpeg` / 浏览器都可解码播放，带 Range 支持。默认 **12 fps、320×176、2 秒**，
约 1 MB/秒 —— I_PCM 不做压缩，分辨率与时长必须克制。

**确定性**：同一组 `prompt + model + seed` 永远得到同一张图 / 同一段视频，
联调时可复现。改 `seed` 即换一套构图。

**文本渲染限制**：内置点阵字体只有 ASCII。中文 prompt 在图片/视频画面上会回落到
`VISUAL SYNTHESIS` 字样，但原文仍完整写入 PNG 元数据；文本接口不受影响。

**状态**：任务与文件全在内存，重启即清空；多进程之间不共享。

---

## 失败注入

在 prompt（或文本 messages）里写标记：

| 标记 | 效果 |
| --- | --- |
| `[[fail]]` / `[[500]]` | HTTP 500 |
| `[[401]]` | HTTP 401（令牌被拒绝） |
| `[[429]]` | HTTP 429（限流） |

也可以设 `MOCK_FAIL_RATE=0.2` 做随机失败，用来验证多渠道故障转移
（配合后台「模型配置」里的主备线路与冷却逻辑）。

OPTIONS 探活与模型列表**永远不会**被注入失败，否则连配置都测不了。

---

## 测试

```bash
npm test                # 47 项单元 / 集成测试（node:test，自己起随机端口）
npm run smoke           # 打已启动的 http://127.0.0.1:3900
npm run smoke:spawn     # 自己起临时实例再跑冒烟，不依赖外部服务
MOCK_VERIFY_VIDEO=1 npm run smoke   # 额外用 ffmpeg 校验视频可完整解码
```

- `test/unit.test.js`：哈希 / PNG chunk 与 CRC / 光栅绘制 / H.264 头部与宏块数 /
  MP4 box 结构 / 文本生成与截断 / 失败注入 / 内存仓淘汰。
- `test/server.test.js`：鉴权、OPTIONS 探活、模型列表、流式与非流式对话、图像
  url/b64、两套视频协议全流程、Range、405/404/409 等边界。
- 装了 ffmpeg 时，测试会额外验证生成的 MP4 能被完整解码（未安装则跳过）。

---

## 目录

```
test/
├── server.js            # 入口：读配置、起服务、打印接入参数
├── src/
│   ├── app.js           # 路由、鉴权、CORS、OPTIONS 白名单
│   ├── config.js        # 环境变量解析 + 内置模型清单
│   ├── http.js          # 请求体、JSON、Range、错误信封、日志
│   ├── errors.js        # OpenAI 风格错误
│   ├── fail.js          # 失败注入
│   ├── store.js         # 内存产物仓（TTL + LRU）
│   ├── hash.js          # SHA-256 / mulberry32 / HSL 配色
│   ├── image/           # 光栅画布 / 点阵字体 / PNG 编码 / 图像生成
│   ├── video/           # 动画帧 / H.264(I_PCM) / MP4 封装 / 视频生成
│   ├── text/            # 中英文模板生成器
│   └── routes/          # models / chat / images / videos / assets
├── scripts/smoke.js     # 冒烟脚本
└── test/                # node:test 用例
```

---

## 已知边界

- 只实现联调需要的接口：没有 embeddings、音频、function calling、真实图片理解。
- 没有速率限制与并发保护 —— 它是本机联调工具，不是对外服务；默认也只监听回环。
- OpenAI 视频端点是按「标准形状」实现的（JSON 与 multipart 的 `input_reference`
  两种提交都收），本项目当前没有对应的协议实现；项目里的视频联调请用 `minimax-video`。
- 单实例内存态：重启后任务、文件与生成记录都会消失。
