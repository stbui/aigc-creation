import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STORAGE_VERSION = 1;
const FILE_NAME = 'sessions.json';

export class SessionStorage {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, FILE_NAME);
    this.tempPath = `${this.filePath}.tmp`;
    this.pending = null;
    this.timer = null;
    this.writing = Promise.resolve();
    mkdirSync(this.dataDir, { recursive: true });
  }

  load() {
    let raw;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[codex-web] failed to read saved sessions:', error.message);
      }
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.sessions)) return [];
      return parsed.sessions;
    } catch (error) {
      console.error('[codex-web] ignoring invalid saved sessions:', error.message);
      return [];
    }
  }

  schedule(sessions) {
    this.pending = sessions;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, 250);
    this.timer.unref?.();
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const sessions = this.pending;
    this.pending = null;
    if (!sessions) return this.writing;

    const payload = JSON.stringify(
      { version: STORAGE_VERSION, savedAt: new Date().toISOString(), sessions },
      null,
      2,
    );
    this.writing = this.writing
      .catch(() => {})
      .then(() => {
        writeFileSync(this.tempPath, payload, { mode: 0o600 });
        renameSync(this.tempPath, this.filePath);
      })
      .catch((error) => {
        console.error('[codex-web] failed to save sessions:', error.message);
      });
    await this.writing;

    if (this.pending) this.schedule(this.pending);
    return this.writing;
  }

  async close() {
    await this.flush();
    await this.writing;
  }
}
