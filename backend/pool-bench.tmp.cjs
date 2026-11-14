const { Worker } = require('node:worker_threads');
const { readFileSync } = require('node:fs');

const CODE = `
  const { parentPort } = require('node:worker_threads');
  const { Jimp, JimpMime } = require('jimp');
  parentPort.on('message', async (msg) => {
    try {
      const img = await Jimp.read(Buffer.from(msg.buf));
      img.cover({ w: msg.w, h: msg.h });
      const out = await img.getBuffer(JimpMime.jpeg, { quality: 78 });
      parentPort.postMessage({ id: msg.id, body: out });
    } catch (e) { parentPort.postMessage({ id: msg.id, body: null }); }
  });
`;

function makePool(n) {
  const workers = Array.from({ length: n }, () => new Worker(CODE, { eval: true }));
  const idle = [...workers];
  const waiting = [];
  return {
    run(buf, w, h, id) {
      return new Promise((resolve) => {
        const task = () => {
          const worker = idle.pop();
          const done = (m) => { worker.off('message', done); idle.push(worker); resolve(m); const nx = waiting.shift(); if (nx) nx(); };
          worker.on('message', done);
          worker.postMessage({ id, buf, w, h });
        };
        if (idle.length) task(); else waiting.push(task);
      });
    },
    close() { workers.forEach((w) => w.terminate()); },
  };
}

(async () => {
  const buf = readFileSync('/tmp/photo12mp.jpg');
  for (const n of [1, 2, 4]) {
    const pool = makePool(n);
    // 预热一次
    await pool.run(buf, 480, 480, -1);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 8 }, (_, i) => pool.run(buf, 480, 480, i)));
    const ms = Date.now() - t0;
    console.log(`pool=${n}: 8 张 → ${(ms / 1000).toFixed(1)}s（单张均摊 ${(ms / 8).toFixed(0)}ms）`);
    pool.close();
  }
})();
