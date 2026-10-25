import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentServer } from './app.mjs';
import { loadConfig } from './config.mjs';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.resolve(thisDir, '../.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[codex-web] ${error.message}`);
  process.exit(1);
}

const { server, sessions, storage } = createAgentServer({ config });

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const displayHost = ['0.0.0.0', '::'].includes(config.host) ? '127.0.0.1' : config.host;
  console.log(`[codex-web] http://${displayHost}:${port}`);
  console.log(`[codex-web] workspace: ${config.workspaceRoot}`);
  console.log(`[codex-web] history: ${storage ? config.dataDir : 'memory only'}`);
  console.log('[codex-web] sdk: @openai/codex-sdk@0.164.0');
  if (!config.accessToken && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    console.warn('[codex-web] warning: listening beyond localhost without AGENT_ACCESS_TOKEN');
  }
  if (config.allowDangerFullAccess) {
    console.warn('[codex-web] warning: danger-full-access is enabled');
  }
});

async function shutdown(signal) {
  console.log(`\n[codex-web] ${signal}, shutting down`);
  sessions.abortAll();
  await storage?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
