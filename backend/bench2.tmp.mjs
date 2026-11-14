import { Jimp, JimpMime } from 'jimp';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

async function make(w, h) {
  const img = new Jimp({ width: w, height: h, color: 0x8899aaff });
  for (let i = 0; i < img.bitmap.data.length; i += 4096) img.bitmap.data[i] = i % 255;
  return img.getBuffer(JimpMime.jpeg, { quality: 88 });
}

async function one(buf) {
  const img = await Jimp.read(buf);
  img.cover({ w: 480, h: 480 });
  return img.getBuffer(JimpMime.jpeg, { quality: 78 });
}

async function run(buf, n, conc) {
  let active = 0; const q = [];
  const acquire = () => active < conc ? (active++, Promise.resolve()) : new Promise(r => q.push(r));
  const release = () => { const nx = q.shift(); if (nx) nx(); else active--; };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, async () => {
    await acquire();
    try { await one(buf); } finally { release(); }
  }));
  return performance.now() - t0;
}

const j = await make(4032, 3024); // 12MP 手机照片量级
console.log(`12MP jpeg = ${(j.length/1024/1024).toFixed(2)}MB, cores=${os.cpus().length}`);
// 预热
await one(j);
for (const conc of [1, 2, 4, 8]) {
  const ms = await run(j, 8, conc);
  console.log(`conc=${conc}: 8 张 480x480 耗时 ${(ms/1000).toFixed(1)}s → 单张均摊 ${(ms/8).toFixed(0)}ms`);
}
