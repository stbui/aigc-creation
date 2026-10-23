/**
 * CSV 生成 (零依赖)。
 *
 * 只做三件必须做对的事, 其余交给调用方:
 *
 *   1. **BOM** —— Excel 打开 UTF-8 CSV 默认按本地编码猜测, 没有 `﻿`
 *      时中文表头会变成乱码。这是"导出文件在运营电脑上打不开"的头号原因。
 *   2. **引号转义** —— 逗号、换行、双引号都按 RFC 4180 用双引号包裹并把
 *      内部引号写成两个。不转义时一个商品名里带逗号就会让整行错位。
 *   3. **公式注入** —— 以 `=` `+` `-` `@` 开头的单元格会被 Excel 当公式执行
 *      (`=HYPERLINK(...)` 是经典的钓鱼手法)。导出内容可能来自用户填写的
 *      昵称/备注, 所以前导 `'` 是必须的, 不能只在"看起来安全"时省略。
 *
 * 金额一律由调用方决定单位。本模块不做任何业务判断。
 */

/** Excel 会把这些首字符当成公式起始 */
const FORMULA_LEADING = /^[=+\-@\t\r]/;

/**
 * 单元格转义。
 *
 * 先做公式注入防护再做引号包裹 —— 顺序反了会把前导 `'` 一起包进引号里,
 * 那样 Excel 反而不认这个转义。
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  if (FORMULA_LEADING.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn<T> {
  /** 表头文案 (中文) */
  label: string;
  /** 取值函数。返回 null/undefined 时写空串 */
  value: (row: T) => unknown;
}

/**
 * 生成 CSV 文本 (含 BOM)。
 *
 * 列由 `columns` 决定而不是遍历对象键 —— 对象键顺序不稳定, 且内部字段
 * (id、rawPayload 之类) 不该出现在运营拿到的表格里。
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(','));
  // 显式 \uFEFF, 不写字面量 BOM —— 后者在编辑器里不可见, 容易被误删
  return '\uFEFF' + [header, ...body].join('\r\n') + '\r\n';
}

/**
 * 导出文件名: `前缀-yyyymmddhhmm.csv`。
 *
 * 文件名里不带用户输入的内容 —— 中文与空格在不同浏览器/系统上会各自编码,
 * 出现过下载后文件名是乱码或被截断的情况。
 */
export function csvFilename(prefix: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}`;
  return `${prefix}-${stamp}.csv`;
}

/**
 * 解析 CSV (RFC 4180, 零依赖)。
 *
 * 只服务于**对账导入**这一个场景, 因此刻意不做类型推断:
 * 一切按字符串返回, 由调用方决定哪列是金额、哪列是交易号。
 *
 * 必须支持的能力 (缺一个都会让真实账单解析错位):
 *   · 首行 BOM (渠道与 Excel 导出的文件常带)
 *   · 双引号包裹的字段, 内部 `""` 表示一个引号
 *   · 引号内的逗号与换行 (备注列里很常见)
 *   · CRLF / LF 混用
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      // CRLF 只消费一次: \r 后面紧跟 \n 时跳过 \n
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      // 完全空的行直接丢弃 (文件末尾的换行、分组空行)
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** 分转元的字符串形式 (导出用)。整数分是存储口径, 元是人对账的口径 */
export function centsToYuan(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
