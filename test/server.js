#!/usr/bin/env node
/**
 * 仿真模型网关入口。
 *
 *   node test/server.js
 *   MOCK_PORT=3901 MOCK_API_KEY=mock-key node test/server.js
 *
 * 只监听本机回环地址是刻意的默认值：这个服务不校验真实凭据、产物
 * 也不代表真实模型，不应该无意中暴露到局域网。需要给手机/容器联调时
 * 显式设置 MOCK_HOST=0.0.0.0。
 */
import { createApp } from './src/app.js';
import { loadConfig, modelIdsOf } from './src/config.js';

const cfg = loadConfig();
const app = createApp({ config: cfg });

const { port, host, url } = await app.listen();
const models = modelIdsOf(cfg);

console.log('');
console.log('  mock-model-gateway —— 仿真模型网关（OpenAI 标准协议）');
console.log('  ─────────────────────────────────────────────────────────');
console.log(`  监听        ${host}:${port}`);
console.log(`  访问        ${url}`);
console.log(`  鉴权        ${cfg.apiKey ? 'Bearer <MOCK_API_KEY>' : '未启用（任意令牌均可）'}`);
console.log(`  模型        ${models.length} 个（GET /v1/models）`);
console.log(`  延迟        文本 ${cfg.latencyChatMs}ms / 图像 ${cfg.latencyImageMs}ms / 视频就绪 ${cfg.latencyVideoReadyMs}ms`);
console.log('');
console.log('  接入本项目后台「模型配置」：');
console.log(`    文本  协议 openai-chat    基址 ${url}  模型 gpt-4o`);
console.log(`    图像  协议 openai         基址 ${url}  模型 gpt-image-2`);
console.log(`    视频  协议 minimax-video  基址 ${url}  模型 MiniMax-Hailuo-2.3`);
console.log('    基址只填根域，不要带 /v1；令牌随便填（除非设置了 MOCK_API_KEY）。');
console.log('');
console.log('  失败注入：prompt 里写 [[fail]] / [[401]] / [[429]]');
console.log('  停止：Ctrl+C');
console.log('');

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n收到 ${signal}，正在关闭…`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
