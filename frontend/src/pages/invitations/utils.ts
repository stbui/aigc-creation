/**
 * 邀请有奖页面的纯函数与外部工具入口 —— 目录内文件的唯一外部工具来源。
 *
 * 约定: `invitations/` 下的文件不从 `src/lib/*` 直接取东西, 一律经由本文件 ——
 * 日期格式化、色板读取与 canvas 海报合成集中可见。
 */

import { DEFAULT_CUSTOM_COLOR, qrColors, tokenColor } from '../../lib/colorPalette';
import { POSTER_HEIGHT, POSTER_WIDTH } from './constants';
import type { MyInvites } from '../../types/api';

/** 海报与站内共用同一组设计令牌 */
export { DEFAULT_CUSTOM_COLOR, qrColors, tokenColor };
/** 千分位 */
export { formatNumber } from '../../lib/format';

/**
 * 页头主标题。
 *
 * 邀请人奖励为 0 时不能写「立赚 0 积分」—— 规则允许只奖励被邀请人；
 * 规则关闭时也不能承诺任何积分。
 */
export function inviteHeroTitle(rule: MyInvites['rule'], enabled: boolean): string {
  if (!enabled) return '邀请好友一起用货觉AI';
  if (rule.inviterCredits > 0) return `邀请好友立赚 ${rule.inviterCredits} 积分`;
  return '邀请好友，注册即得积分';
}

/** 邀请步骤文案里的一条 */
export interface InviteStep {
  title: string;
  desc: string;
}

/** 邀请步骤：奖励口径随真实规则变化，不写兑现不了的数字。 */
export function buildInviteSteps(
  rule: MyInvites['rule'],
  enabled: boolean,
  inviteCode: string,
): InviteStep[] {
  return [
    { title: '分享邀请链接', desc: `复制含专属邀请码的链接发送给好友：${inviteCode}` },
    {
      title: '好友注册',
      desc:
        rule.inviteeCredits > 0
          ? `好友通过链接注册即得 ${rule.inviteeCredits} 积分`
          : '好友通过链接注册后自动与你的账号绑定',
    },
    {
      title: '奖励自动发放',
      desc:
        !enabled || rule.inviterCredits <= 0
          ? '当前未配置邀请人奖励，分享仅记录邀请关系'
          : rule.triggerOn === 'first_pay'
            ? `好友首次付费成功后，你得 ${rule.inviterCredits} 积分`
            : `好友注册成功后，你得 ${rule.inviterCredits} 积分`,
    },
  ];
}

/** 签到日期只留「月/日」。按字符串切分, 避免时区把 10-31 显示成 10-30 */
export function formatForecastDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${Number(m[2])}/${Number(m[3])}` : day;
}

/** 邀请记录的时间只留年月日 */
export function formatBoundDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-CN');
}

/** 海报下载文件名 */
export function posterFileName(code: string): string {
  return `货觉AI-邀请海报-${code}.png`;
}

/**
 * 合成邀请海报 (640×880 PNG data URL)。
 *
 * 用 canvas 手绘而不是拼模板图: 文案随奖励规则变化 (规则关闭时不能承诺积分),
 * 拼图就得为每种状态准备一张模板。字体用系统栈, 中文在各平台都不会缺字。
 */
export async function buildInvitePoster(opts: {
  qrDataUrl: string;
  code: string;
  claim: string;
}): Promise<string> {
  const W = POSTER_WIDTH;
  const H = POSTER_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 canvas');

  const font = (size: number, weight = '400') =>
    `${weight} ${size}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

  // canvas 只吃具体颜色, 令牌在这里读一次 —— 海报与站内用的是同一组色
  const color = {
    brand: tokenColor('--brand', DEFAULT_CUSTOM_COLOR),
    brandLight: tokenColor('--surface-brand-3', '#8064F6'),
    onBrand: tokenColor('--on-brand', '#FFFFFF'),
    text: tokenColor('--text-strong', '#171A2B'),
    body: tokenColor('--text-body', '#4E5969'),
    surface: tokenColor('--surface', '#F2F4F7'),
    muted: tokenColor('--text-muted', '#5B6474'),
  };

  // 背景: 品牌紫渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, color.brand);
  grad.addColorStop(1, color.brandLight);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = color.onBrand;
  ctx.font = font(44, '700');
  ctx.fillText('货觉AI', W / 2, 88);
  ctx.font = font(18);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = color.onBrand;
  ctx.fillText('电商智能视觉创作平台', W / 2, 124);
  ctx.globalAlpha = 1;

  // 白色主卡
  roundRect(ctx, 40, 160, W - 80, H - 240, 28);
  ctx.fillStyle = color.onBrand;
  ctx.fill();

  ctx.fillStyle = color.text;
  ctx.font = font(28, '700');
  ctx.fillText(opts.claim, W / 2, 246);

  // 二维码 (520px 源图缩到 260, 保证高清屏不糊)
  const img = await loadImage(opts.qrDataUrl);
  const qrSize = 260;
  ctx.drawImage(img, (W - qrSize) / 2, 292, qrSize, qrSize);

  ctx.fillStyle = color.body;
  ctx.font = font(18);
  ctx.fillText('用手机扫码注册，自动绑定邀请关系', W / 2, 596);

  // 邀请码胶囊
  roundRect(ctx, 120, 626, W - 240, 78, 18);
  ctx.fillStyle = color.surface;
  ctx.fill();
  ctx.fillStyle = color.brand;
  ctx.font = font(26, '700');
  ctx.fillText(`邀请码 ${opts.code}`, W / 2, 676);

  ctx.fillStyle = color.muted;
  ctx.font = font(15);
  ctx.fillText('货觉AI · 商品主图 / 详情图 / 抠图 / 精修，一站式完成', W / 2, 762);

  return canvas.toDataURL('image/png');
}

/** 圆角矩形路径。不用 ctx.roundRect: 老版本 Safari 没有这个方法 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('二维码图片加载失败'));
    img.src = src;
  });
}
