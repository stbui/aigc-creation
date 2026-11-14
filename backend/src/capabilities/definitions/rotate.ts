/**
 * 旋转角度 —— 参考站 rotate-angle。三滑块(旋转/倾斜/缩放)改变展示视角。
 *
 * 2026-10-20 从 capability.registry.ts 抽离为独立文件。
 * 抽离的意义: 能力定义此前散在 registry / gateway-prompt / mock provider /
 * channel-config 四处, 新增一项要改四个文件且漏改不报错; 现在自包含在一个对象里,
 * 漏声明由 assertCapabilityIntegrity 在装配期拦下。
 */

import type { CapabilityPlugin } from '../capability-plugin.type';
import { editImageIntent } from '../model-mapping';
import { QUALITY_OPTIONS, RATIOS_WITH_ORIGINAL } from './param-options';

/**
 * 数值统一到两位小数：`sanitizeParams` 只夹取区间不取整，缩放滑块 step=0.01
 * 会把 0.8499999999999999 这类浮点长尾带进提示词，后台「查看提示词」也会
 * 露出同样的脏值（页面展示用的是 `toFixed(2)`，两边口径必须一致）。
 */
function round2(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
}

/**
 * 缩放系数 → 画面占比语言。预览用的是 `scale(zoom)`（`RotateAngleSubjectStage`），
 * 改变的是商品在画面里的大小，不是镜头焦距；裸写「缩放 1.1」模型无法执行。
 */
function zoomText(zoom: number): string {
  if (zoom === 1) return '商品在画面中的占比保持原样';
  const percent = Math.round(Math.abs(zoom - 1) * 100);
  return zoom > 1
    ? `商品在画面中放大约 ${percent}%，按新视角自然取景，不裁掉商品主体`
    : `商品在画面中缩小约 ${percent}%，新增画面区域按原场景自然补全`;
}

export const Rotate: CapabilityPlugin = {
  id: 'rotate',
  name: '旋转角度',
  group: 'ai_retouch',
  summary: '调整商品展示角度，补全视觉构图。',
  sidebarHint: '调整商品展示视角，生成新的观察角度',
  mode: 'real',
  creditCost: 5, // 原页面标注「本次消耗5积分」
  params: [
    { key: 'yaw', label: '旋转（水平角）', type: 'number', default: 0, min: -90, max: 90, step: 1 },
    {
      key: 'pitch',
      label: '倾斜（俯仰角）',
      type: 'number',
      default: 0,
      min: -30,
      max: 60,
      step: 1,
    },
    { key: 'zoom', label: '缩放', type: 'number', default: 1, min: 0.8, max: 1.2, step: 0.01 },
    {
      key: 'ratio',
      label: '画面比例',
      type: 'enum',
      default: 'original',
      options: RATIOS_WITH_ORIGINAL,
    },
    {
      key: 'size',
      label: '画质（输出边长）',
      type: 'enum',
      default: '1k',
      options: QUALITY_OPTIONS,
    },
    /* 参考站 VIEW_ROTATION 的字段名；页面按主体/摄像头方向换算后同时提交，旧 yaw/pitch/zoom 兼容。 */
    {
      key: 'azimuthDeg',
      label: '方位角（参考站字段）',
      type: 'number',
      min: -90,
      max: 90,
      step: 1,
      hidden: true,
    },
    {
      key: 'elevationDeg',
      label: '俯仰角（参考站字段）',
      type: 'number',
      min: -30,
      max: 60,
      step: 1,
      hidden: true,
    },
    {
      key: 'zoomFactor',
      label: '缩放系数（参考站字段）',
      type: 'number',
      min: 0.8,
      max: 1.2,
      step: 0.01,
      hidden: true,
    },
    /*
     * 参考站 VIEW_ROTATION 仅在非原比例时提交 imageRatio。比例由 `ratio` 经
     * 意图 size → aspectRatio 下发，不进提示词（写进去是元指令，可能被当成
     * 画面内容）；这里保留字段只为对齐参考站契约，并挡住任意文本注入。
     */
    {
      key: 'imageRatio',
      label: '画面比例（参考站字段）',
      type: 'text',
      hidden: true,
      pattern: '^[0-9]+:[0-9]+$',
    },
  ],
  buildPrompt: (p) => {
    const azimuth = round2(p.azimuthDeg ?? p.yaw, 0);
    const elevation = round2(p.elevationDeg ?? p.pitch, 0);
    const zoom = round2(p.zoomFactor ?? p.zoom, 1);

    /*
     * 三轴全为默认值时不能再要求「改变视角并重建商品」：那只会得到一张有
     * 轻微形变的重绘图，还照扣 5 积分。比例走协议字段，这里只守住视角与构图。
     */
    if (azimuth === 0 && elevation === 0 && zoom === 1) {
      return (
        '保持输入图的观察视角、商品占比与场景，不重绘商品；' +
        '仅按请求画幅调整构图，外扩区域延续原背景风格。'
      );
    }

    /*
     * 方位角的正负沿用 `utils.ts` 的参考站换算（主体模式与 UI 滑杆相反），
     * 这里只说明它是观察方向、不是镜像，不擅自定义左右 / 俯仰的具体朝向。
     * 商品一致性措辞复用 main_image.ts / sku_image.ts，避免各写一份硬约束。
     */
    return (
      `以输入图的正视角为 0° 基准，改变观察视角：方位角 ${azimuth}°、俯仰角 ${elevation}°；` +
      '角度正负仅表示观察方向相反，不代表商品镜像或翻转。' +
      `${zoomText(zoom)}。` +
      '从新观察角度呈现同一件商品，延续原图的场景、光线风格与色调，阴影与高光随新视角自然调整，不新增无关元素，不改变背景类型。' +
      '必须保持输入图中的同一件商品及其数量；商品结构、颜色、材质、纹理、logo、包装与可见配件必须与参考图一致；' +
      '不得替换商品、改变比例、拉伸变形或增删部件；参考图未覆盖的角度只做结构一致的合理推演，不得编造背面文字、图案或配件。' +
      '不生成品牌 logo、价格标签、平台水印或无关文字；成图不得出现错字、乱码、重复主体、拼接痕迹或装饰性假文案。'
    );
  },
  modality: 'image',
  model: { capability: 'image', operation: 'image_to_image', intent: editImageIntent },
  inputs: 1,
  inputImageMode: 'edit',
  inWorkbench: true,
};
