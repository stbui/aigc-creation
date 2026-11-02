import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, parseCsv, toCsv } from './csv';

describe('decodeCsvBuffer', () => {
  it('UTF-8 BOM 去除', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('商户订单号', 'utf8')]);
    expect(decodeCsvBuffer(buf)).toBe('商户订单号');
  });

  it('UTF-8 正常解码', () => {
    expect(decodeCsvBuffer(Buffer.from('交易成功,9.90', 'utf8'))).toBe('交易成功,9.90');
  });

  it('非 UTF-8 回退 GB18030', () => {
    // GBK: 中=D6D0 文=CEC4
    expect(decodeCsvBuffer(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文');
  });

  it('空输入', () => {
    expect(decodeCsvBuffer(Buffer.alloc(0))).toBe('');
  });
});

describe('parseCsv', () => {
  it('去 BOM、CRLF、引号内逗号与换行', () => {
    const text = '\uFEFFa,b\r\n"x,y","line1\nline2"\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2'],
    ]);
  });

  it('双引号转义', () => {
    expect(parseCsv('a,"he said ""hi"""')).toEqual([['a', 'he said "hi"']]);
  });
});

describe('toCsv', () => {
  it('带 BOM、公式注入防护与引号转义', () => {
    const csv = toCsv(
      [
        { label: '名称', value: (r: { name: string; note: string }) => r.name },
        { label: '备注', value: (r) => r.note },
      ],
      [{ name: '=HYPERLINK("http://evil")', note: 'a,b' }],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`'=HYPERLINK(""http://evil"")`);
    expect(csv).toContain('"a,b"');
  });
});
