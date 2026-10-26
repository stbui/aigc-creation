#!/usr/bin/env node
/**
 * verify-deps.js — 依赖一致性审计
 *
 * 为什么需要它: 本项目的 node_modules 是用 curl + tar 直装 registry 装出来的
 * (npm 走 broker 代理会触发 5 分钟硬超时), 安装器不解析 semver, 一律取 latest,
 * 于是装出过大量版本漂移, 其中几处直接导致运行时崩溃:
 *
 *   type-is@3 (纯 ESM)  → body-parser 2.x CJS require 拿到命名空间 → "typeis is not a function"
 *   raw-body@4          → 导出变为 { getRawBody } → "getBody is not a function"
 *   media-typer@1.1.1   → 顶层版本被 multer 嵌套的 type-is@1.6.18 (需要 0.3 API) 解析到
 *                          → format() 抛错被 catch → multer 静默不解析 multipart (最阴的一个)
 *
 * 用法:
 *   node scripts/verify-deps.js            # 审计并打印全部问题
 *   node scripts/verify-deps.js --critical # 只报运行时关键链 (express/body-parser/multer/prisma/jimp)
 *   node scripts/verify-deps.js --quiet    # 只输出问题数量, 有问题时 exit 1 (可接 CI)
 *
 * 退出码: 0 = 无问题; 1 = 存在问题。
 */
const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'node_modules');
const args = process.argv.slice(2);
const CRITICAL_ONLY = args.includes('--critical');
const QUIET = args.includes('--quiet');

// 运行时关键链: 这些包出问题会直接让服务起不来或上传静默失败
const CRITICAL = new Set([
  'express', 'body-parser', 'raw-body', 'type-is', 'media-typer', 'mime-types', 'mime-db',
  'content-type', 'content-disposition', 'cookie', 'accepts', 'fresh', 'negotiator', 'qs',
  'bytes', 'on-finished', 'http-errors', 'unpipe', 'iconv-lite', 'multer', 'busboy',
  'append-field', 'finalhandler', 'router', 'send', 'serve-static', 'statuses', 'vary',
  '@prisma/client', '@prisma/driver-adapter-utils', '@prisma/get-platform',
  'jimp', '@jimp/core', 'bcryptjs', 'class-validator', 'class-transformer',
]);

function loadPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 收集顶层已安装包 (含 @scope/x), 不下钻嵌套 node_modules */
function collectTop() {
  const top = new Map();
  if (!fs.existsSync(NM)) return top;
  for (const entry of fs.readdirSync(NM)) {
    if (entry.startsWith('.')) continue;
    const dirs = entry.startsWith('@')
      ? fs.readdirSync(path.join(NM, entry)).map((s) => path.join(NM, entry, s))
      : [path.join(NM, entry)];
    for (const dir of dirs) {
      const p = loadPkg(dir);
      if (p && p.name && p.version) top.set(p.name, p);
    }
  }
  return top;
}

const parse = (v) => {
  // 允许 "1" / "1.2" 这类短版本号 (对应 ^1 / >=1 这样的范围写法)
  const m = /^v?(\d+|[xX*])(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?/.exec(String(v).trim());
  if (!m || m[1] === 'x' || m[1] === 'X' || m[1] === '*') return null;
  const seg = (s, d) => (s === undefined || s === 'x' || s === 'X' || s === '*' ? d : +s);
  return [+m[1], seg(m[2], 0), seg(m[3], 0)];
};
const cmp = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2]);

/** 判断 range 中某一段是否被显式给出 (x-range 检测) */
function isPartial(v) {
  return /^[xX*]/.test(String(v).trim()) || !/\.\d/.test(String(v));
}

/**
 * semver satisfies (仅覆盖 npm 常用形式: ^ ~ >= <= > < = 与 || 、x-range)
 * 注意: caret 上界必须严格 —— 4.0.0 不满足 ^3.0.2。
 * (审计脚本第一版把上界写反, 整类"主版本过高"漂移被漏检; 又因正则要求必须有点号而漏判 ^1)
 */
function satisfies(version, range) {
  const v = parse(version);
  if (!v) return true;
  return range.split('||').some((raw) => {
    const part = raw.trim();
    if (part === '*' || part === '' || part === 'latest' || /^(workspace|file:|link:|npm:)/.test(part)) return true;
    if (part.startsWith('^')) {
      const b = parse(part.slice(1));
      if (!b) return false;
      if (isPartial(part.slice(1))) return v[0] === b[0]; // ^1 → >=1.0.0 <2.0.0
      const upper = b[0] > 0 ? [b[0] + 1, 0, 0] : b[1] > 0 ? [0, b[1] + 1, 0] : [0, 0, b[2] + 1];
      return cmp(v, b) >= 0 && cmp(v, upper) < 0;
    }
    if (part.startsWith('~')) {
      const b = parse(part.slice(1));
      if (!b) return false;
      if (isPartial(part.slice(1))) return v[0] === b[0];
      return cmp(v, b) >= 0 && cmp(v, [b[0], b[1] + 1, 0]) < 0;
    }
    const m = /^(>=|<=|>|<|=)?\s*([\dxX*]+(?:\.[\dxX*]+){0,2})/.exec(part);
    if (!m) return true;
    const op = m[1] || '=';
    const verStr = m[2];
    const b = parse(verStr);
    if (!b) return true;
    const given = verStr.split('.').filter((s) => !/^[xX*]$/.test(s)).length;
    const c = cmp(v, b);
    switch (op) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default:
        // 无运算符的精确 pin: 段数不足时只比较给出的段 (如 "5.2" → >=5.2.0 <5.3.0)
        if (given < 3) return given === 1 ? v[0] === b[0] : v[0] === b[0] && v[1] === b[1];
        return c === 0;
    }
  });
}

/** 已确认安全、且刻意为之的精确 pin 偏差 (不计入失败) */
const ACCEPTED_PINS = new Set([
  '@nestjs/platform-express@12.1.3>express@5.2.1', // 实际 5.3.0, 已通过 e2e + 浏览器全流程验证
  '@prisma/dev@0.24.17>@prisma/get-platform@7.2.0', // @prisma/dev 不在本项目运行路径
]);

/**
 * 已验证无影响的偏差簇 (按依赖方包名前缀匹配)。
 * 每条都写明验证依据 —— 否则工具每次报几十条噪音, 很快就会被无视, 那还不如没有。
 */
const KNOWN_BENIGN = [
  ['@jimp/', 'jimp 1.6.1 插件声明 zod ^3.23.8, 实际 4.6.7; options schema API 兼容, 三项能力 e2e + 浏览器实测通过'],
  ['load-bmfont', '声明 mime ^1.3.4, 实际 3.0.0; 字体加载 (loadFont/print) 实测正常'],
  ['file-type', 'strtok3/token-types 补丁级偏差; @nestjs/common 启动正常'],
  ['pixelmatch', '测试用图像对比库, 不在运行路径'],
  ['prebuild-install', 'better-sqlite3 的安装脚本依赖链; 已弃用官方 adapter, 改用自研 node:sqlite adapter'],
  ['libsql', '@libsql/* 已弃用 (原生包装不上), 同上'],
  ['@prisma/adapter-better-sqlite3', '已弃用的官方 adapter, 不被引用'],
  ['@prisma/adapter-libsql', '已弃用的官方 adapter, 不被引用'],
  ['d3-', 'visx/d3 系列为前端误装进 backend 的依赖, 运行时不引用'],
  ['@visx/', '同上'],
  ['internmap', 'd3 依赖, 未被运行路径引用'],
  ['terser', 'webpack 压缩链, 仅 nest build 使用'],
  ['terser-webpack-plugin', 'webpack 压缩链, 仅 nest build 使用'],
  ['schema-utils', 'webpack 校验链, 仅 nest build 使用'],
  ['jest-worker', 'webpack worker 池, 仅 nest build 使用'],
  ['esrecurse', 'webpack 依赖解析链, 仅 nest build 使用'],
  ['fork-ts-checker-webpack-plugin', '仅 nest build 使用 (其 minimatch/chokidar 偏差同样只影响构建期)'],
  ['@jridgewell/', 'source-map 链, 仅构建期使用'],
  ['glob', '仅构建期/CLI 使用'],
  ['foreground-child', 'CLI 子进程封装, 不在服务运行路径'],
  ['@inquirer/', 'CLI 交互链, 不在服务运行路径'],
  ['c12', 'prisma.config.ts 加载链; prisma generate / db push 实测正常'],
  ['pkg-types', 'c12 依赖, 同上'],
  ['@angular-devkit/', '@nestjs/schematics 依赖, 仅 nest generate 使用'],
  ['@nestjs/cli', '构建期 CLI, nest build 实测通过'],
  ['image-q', '像素级图像处理, 未被引用'],
  ['promise-limit', '@libsql 子依赖'],
  ['better-sqlite3', '已弃用官方 adapter 的依赖'],
  ['@libsql/', '@libsql/* 已弃用 (原生包装不上), 同上'],
  ['@nestjs/common', '其 file-type 精确 pin 22.1.1 实际 21.3.4; 服务启动与 e2e 全程正常'],
  ['@nestjs/schematics', '其 @angular-devkit 精确 pin 19.0.1 实际 19.1.2; 仅 nest generate 使用, 本项目未用到'],
  ['proxy-addr', '其 ipaddr.js 精确 pin 1.9.1 实际 2.5.0; 只影响 req.ip 解析, 各路由实测正常'],
  ['@tokenizer/inflate', '其 token-types 补丁级偏差, 位于 file-type/jimp IO 链; 图片编解码实测正常'],
  ['token-types', '其 @borewit/text-codec 偏差, 同上'],
  ['readable-web-to-node-stream', '其 readable-stream 偏差, 位于 strtok3/file-type 链; 实测正常'],
  ['source-map-support', '其 source-map 主版本偏差, 仅影响堆栈映射; 服务实测正常'],
];

/**
 * 按 Node 的实际解析顺序取某个依赖边实际会用到的副本:
 * 先看依赖方自己的 node_modules (嵌套), 再回落顶层。嵌套副本存在即视为已解决。
 */
function resolveEdge(fromDir, dep, range, top) {
  const nested = loadPkg(path.join(NM, fromDir, 'node_modules', dep));
  if (nested && nested.version && satisfies(nested.version, range)) {
    return { ok: true, via: 'nested', version: nested.version };
  }
  if (nested && nested.version && !satisfies(nested.version, range)) {
    return { ok: false, via: 'nested', version: nested.version };
  }
  const t = top.get(dep);
  if (!t) return { ok: false, via: 'missing' };
  return { ok: satisfies(t.version, range), via: 'top', version: t.version };
}

/** 检查嵌套副本是否存在 (手工修复过的高危包必须保持嵌套) */
const REQUIRED_NESTING = [
  ['multer/node_modules/type-is', '1.6.18', 'multer@2.4.0 需要 type-is ^1.6.18'],
  ['multer/node_modules/type-is/node_modules/media-typer', '0.3.0', 'type-is@1.6.18 需要 media-typer ^0.3.0 (1.x API 不兼容, 错版会让 multer 静默不解析 multipart)'],
  ['multer/node_modules/append-field', '1.0.0', 'multer@2.4.0 需要 append-field ^1.0.0'],
  ['webpack/node_modules/mime-types', '2.1.35', 'webpack@5 需要 mime-types ^2.1.x, 与 express 5 的 ^3.0.0 冲突'],
  ['@nestjs/config/node_modules/dotenv', '18.0.3', '@nestjs/config@12.0.1 精确 pin dotenv 18.0.3, 顶层 17.4.2 是 prisma/@prisma/config 的, 缺嵌套会静默降级到 17.x'],
  // 反例留档: raw-body@3.0.2 要 iconv-lite ~0.7.0, 顶层 0.7.3 已满足,
  // 早期误以为它精确依赖 0.6.3 而嵌套安装, 结果遮蔽了正确版本 —— 故此处不再要求嵌套。
];

/**
 * 校验 package.json 里被 npm run 引用的脚本都已定义。
 * 漏注册时 npm 只会报 Missing script，start.sh 的初始化链路会直接中断。
 */
function missingScriptRefs(pkg) {
  const scripts = pkg.scripts || {};
  const missing = [];
  for (const [name, command] of Object.entries(scripts)) {
    for (const match of String(command).matchAll(/\bnpm run(?: --silent)? ([A-Za-z0-9:_-]+)/g)) {
      if (!(match[1] in scripts)) missing.push(`${name} -> npm run ${match[1]}`);
    }
  }
  return missing;
}

function main() {
  const top = collectTop();
  const issues = [];
  const rootPkg = loadPkg(path.join(__dirname, '..'));
  const scriptIssues = rootPkg ? missingScriptRefs(rootPkg) : ['backend/package.json 无法读取'];

  for (const [name, pkg] of top) {
    if (CRITICAL_ONLY && !CRITICAL.has(name)) continue;
    const deps = pkg.dependencies || {};
    for (const [dep, range] of Object.entries(deps)) {
      if (CRITICAL_ONLY && !CRITICAL.has(dep)) continue;
      // 按 Node 解析顺序: 嵌套副本优先, 顶层兜底
      const r = resolveEdge(name, dep, range, top);
      if (r.ok) continue;
      if (r.via === 'missing') {
        const benign = KNOWN_BENIGN.find(([p]) => name.startsWith(p));
        issues.push({ level: 'MISSING', from: `${name}@${pkg.version}`, need: `${dep}@${range}`, benign: benign && benign[1] });
        continue;
      }
      if (r.via === 'nested') {
        issues.push({
          level: 'NESTED',
          from: `${name}@${pkg.version}`,
          need: `${dep}@${range}`,
          has: `${r.version} (嵌套副本不满足)`,
        });
        continue;
      }
      // 顶层不满足: 无运算符的精确 pin 单独归类 (通常是刻意偏差)
      const isPin = !/[\^~><=*x|\s]/.test(range.trim());
      const key = `${name}@${pkg.version}>${dep}@${range}`;
      if (isPin && ACCEPTED_PINS.has(key)) continue;
      const benign = KNOWN_BENIGN.find(([p]) => name.startsWith(p));
      issues.push({
        level: isPin ? 'PIN' : 'DRIFT',
        from: `${name}@${pkg.version}`,
        need: `${dep}@${range}`,
        has: r.version,
        benign: benign && benign[1],
      });
    }
  }

  const missingNesting = [];
  for (const [rel, version, why] of REQUIRED_NESTING) {
    const p = loadPkg(path.join(NM, rel));
    if (!p) missingNesting.push(`${rel}@${version} 缺失 — ${why}`);
    else if (p.version !== version) missingNesting.push(`${rel}@${version} 实际为 ${p.version} — ${why}`);
  }

  // 致命 = 非 PIN、且未被记录为已验证无害的偏差
  const fatalIssues = issues.filter((i) => !i.benign);
  const benignCount = issues.length - fatalIssues.length;
  const fatal = fatalIssues.length + missingNesting.length + scriptIssues.length;
  if (QUIET) {
    console.log(fatal === 0 ? 'deps OK' : `deps: ${fatal} 个问题`);
    process.exit(fatal === 0 ? 0 : 1);
  }

  console.log(`审计目录: ${NM}`);
  console.log(`顶层包数: ${top.size} | 模式: ${CRITICAL_ONLY ? '仅运行时关键链' : '全部'}`);
  console.log(`致命 ${fatal} | 已记录无害 ${benignCount} | 提示级(PIN) ${issues.filter((i) => i.level === 'PIN').length}`);
  for (const i of fatalIssues) {
    const tag = i.level === 'PIN' ? '  (PIN)' : '  ';
    console.log(`${tag}${i.level.padEnd(7)} ${i.from} 需要 ${i.need}${i.has ? `, 实际 ${i.has}` : ''}`);
  }
  if (benignCount > 0) {
    console.log(`\n已记录为验证无害 (${benignCount} 条, 见脚本 KNOWN_BENIGN):`);
    const seen = new Set();
    for (const i of issues) {
      if (!i.benign || seen.has(i.benign)) continue;
      seen.add(i.benign);
      console.log(`  · ${i.benign}`);
    }
  }
  console.log(`\n必需嵌套副本: ${REQUIRED_NESTING.length - missingNesting.length}/${REQUIRED_NESTING.length} 就位`);
  for (const m of missingNesting) console.log(`  NESTING ${m}`);
  console.log(`脚本引用: ${scriptIssues.length === 0 ? '全部已定义' : `${scriptIssues.length} 个缺失`}`);
  for (const s of scriptIssues) console.log(`  SCRIPT ${s}`);
  console.log(fatal === 0 ? '\n结论: 依赖链无致命问题' : `\n结论: ${fatal} 个致命问题需修复`);
  process.exit(fatal === 0 ? 0 : 1);
}

main();
