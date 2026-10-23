import { pick, seededRng, sha256 } from '../hash.js';

/**
 * 文生文的「仿真模型」实现。
 *
 * 规则合成而非真实推理：把 prompt 拆成「需求 + 创作建议 + 可用提示词」，
 * 建议项由 prompt 的 SHA-256 决定（同一输入永远同一输出），并明确标注
 * 这是仿真内容。这样既能让业务链路拿到结构合理的中文/英文文本，
 * 又不会让任何人误以为它来自真实模型。
 *
 * 支持两种输入：
 *   - 纯文本 messages；
 *   - 多模态 content parts（本项目「图片转提示词」会发 base64 图片块）。
 */

const SUBJECTS_ZH = [
  '产品主体居中，突出材质与工艺细节',
  '人物与场景自然互动，情绪克制的叙事感',
  '电商主图式清晰陈列，主体占比 60% 左右',
  '静物特写，强调纹理与边缘高光',
  '使用场景中的产品，保留真实比例关系',
];

const COLORS_ZH = [
  '低饱和莫兰迪色系，画面统一在冷灰与米白之间',
  '高对比冷暖撞色，主色不超过三种',
  '品牌紫与暖白主导，点缀少量金属色',
  '自然原木色与雾绿，营造松弛感',
  '深色背景配单一亮色，形成视觉锚点',
];

const LIGHTS_ZH = [
  '柔和侧逆光，轮廓线清晰但不刺眼',
  '顶部大面积柔光箱，阴影过渡细腻',
  '黄昏自然光，色温偏暖，保留环境光层次',
  '硬光造型，强调材质反射与几何阴影',
  '均匀无影光，适合电商详情页展示',
];

const COMPOSITIONS_ZH = [
  '三分法构图，主体落在右下交叉点',
  '中心对称构图，留白充足',
  '对角线动势，视线从左上引向主体',
  '前景虚化 + 中景主体 + 干净背景',
  '俯拍平铺，元素间距均匀',
];

const STYLES_ZH = [
  '商业产品摄影',
  '3D 渲染质感',
  '电影感写实',
  '扁平插画',
  '极简编辑风',
];

const NEGATIVES_ZH = [
  '低清晰度、过曝、畸变、水印、多余文字、杂乱背景',
  '塑料感、噪点、色差、比例失调、重复主体',
  '模糊边缘、过饱和、强烈噪点、拼贴痕迹',
];

const SUBJECTS_EN = [
  'a clearly staged product hero with emphasis on material and craft',
  'a restrained lifestyle scene with a human subject interacting naturally',
  'a clean e-commerce catalog composition with the subject occupying 60% of frame',
  'a close-up still life emphasising texture and rim highlights',
  'the product in a believable usage context with true-to-life proportions',
];

const COLORS_EN = [
  'muted Morandi palette, cool grey and off-white',
  'high-contrast warm/cool pairing limited to three colours',
  'brand purple with warm white and restrained metallic accents',
  'natural wood tones with misty green for a relaxed mood',
  'dark background with one bright accent as the visual anchor',
];

const LIGHTS_EN = [
  'soft side backlight with a clean but gentle rim',
  'large overhead softbox with smooth shadow falloff',
  'golden-hour natural light with warm, layered ambience',
  'hard light shaping that reveals material reflections',
  'even shadowless light suited to e-commerce detail pages',
];

const COMPOSITIONS_EN = [
  'rule-of-thirds with the subject on the lower-right intersection',
  'centred symmetrical composition with generous negative space',
  'diagonal momentum leading the eye from top-left to the subject',
  'foreground bokeh, midground subject, clean background',
  'top-down flat lay with even spacing between elements',
];

const STYLES_EN = [
  'commercial product photography',
  '3D render finish',
  'cinematic realism',
  'flat editorial illustration',
  'minimal editorial style',
];

const NEGATIVES_EN = [
  'low resolution, overexposure, distortion, watermark, extra text, cluttered background',
  'plastic look, noise, colour cast, wrong proportions, duplicated subject',
  'soft edges, oversaturation, heavy grain, collage artifacts',
];

const IMAGE_READINGS_ZH = [
  '主体清晰、边缘干净，适合作为商品主图或抠图源',
  '构图偏居中，背景元素较多，建议生成时加入留白与景深',
  '色彩层次完整，可提取主色作为生成图的品牌色',
  '光线方向明确，适合做材质与反射的强化',
];

const IMAGE_READINGS_EN = [
  'clean subject edges, suitable as a hero image or cut-out source',
  'centred composition with a busy background; add negative space and depth of field',
  'complete colour hierarchy; the dominant colour is a good brand anchor',
  'clear light direction, suitable for reinforcing material and reflection',
];

function contentOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return { texts: [content], images: 0 };
  if (!Array.isArray(content)) return { texts: [], images: 0 };
  const texts = [];
  let images = 0;
  for (const part of content) {
    if (typeof part === 'string') texts.push(part);
    else if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    else if (part?.type === 'image_url' || part?.type === 'image') images += 1;
  }
  return { texts, images };
}

/** 粗略 token 估计：CJK 约 1 字 1 token，拉丁文约 4 字符 1 token。 */
export function estimateTokens(text) {
  const s = String(text ?? '');
  const cjk = (s.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const rest = s.replace(/[㐀-鿿豈-﫿]/g, ' ');
  const words = (rest.match(/[A-Za-z0-9_]+/g) ?? []).length;
  const punctuation = (rest.match(/[^\sA-Za-z0-9_]/g) ?? []).length;
  return Math.max(1, Math.round(cjk + words * 1.3 + punctuation * 0.25));
}

function detectLanguage(text) {
  const s = String(text ?? '');
  const cjk = (s.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk >= latin * 0.15 ? 'zh' : 'en';
}

function clip(text, maxTokens) {
  if (estimateTokens(text) <= maxTokens) return text;
  const ratio = maxTokens / estimateTokens(text);
  const targetChars = Math.max(16, Math.floor([...text].length * ratio));
  return `${[...text].slice(0, targetChars).join('')}\n…（输出已按 max_tokens 截断）`;
}

/**
 * @param {{
 *   model: string,
 *   messages: Array<{role:string, content:any}>,
 *   maxTokens?: number,
 *   temperature?: number,
 * }} opts
 */
export function generateText(opts) {
  const messages = Array.isArray(opts.messages) ? opts.messages : [];
  const joined = messages
    .map((m) => {
      const { texts } = contentOf(m);
      return texts.join('\n');
    })
    .join('\n')
    .trim();
  const imageCount = messages.reduce((sum, m) => sum + contentOf(m).images, 0);
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
  const userText = (lastUser ? contentOf(lastUser).texts.join('\n') : '') || joined;
  const prompt = userText.trim() || '（空提示词）';
  const lang = detectLanguage(prompt);
  const rng = seededRng(sha256(`${opts.model}|${joined}`));

  const promptSummary = prompt.replace(/\s+/g, ' ').slice(0, 140);
  let content;
  if (lang === 'zh') {
    const subject = pick(rng, SUBJECTS_ZH);
    const color = pick(rng, COLORS_ZH);
    const light = pick(rng, LIGHTS_ZH);
    const composition = pick(rng, COMPOSITIONS_ZH);
    const style = pick(rng, STYLES_ZH);
    const negative = pick(rng, NEGATIVES_ZH);
    if (imageCount > 0) {
      const reading = pick(rng, IMAGE_READINGS_ZH);
      content = [
        '【仿真识图】',
        `检测到 ${imageCount} 张输入图片。以下为基于图像元信息与规则模板的模拟分析，不是真实视觉模型推理：`,
        '',
        `画面判断：${reading}`,
        `主体建议：${subject}`,
        `色彩建议：${color}`,
        '',
        '建议提示词：',
        `"${promptSummary}，${style}，${light}，${composition}，${color}，high detail"`,
        '',
        `负向提示词：${negative}`,
        '',
        '说明：以上内容由 mock-model-gateway 规则合成，用于验证通道与业务链路。',
      ].join('\n');
    } else {
      content = [
        '【仿真模型输出】',
        `需求理解：${promptSummary}`,
        '',
        '创作建议',
        `1. 画面主体：${subject}`,
        `2. 色彩基调：${color}`,
        `3. 光影方案：${light}`,
        `4. 构图方式：${composition}`,
        `5. 整体风格：${style}`,
        '',
        '可直接使用的提示词：',
        `"${promptSummary}，${style}，${light}，${composition}，${color}，high detail"`,
        '',
        `负向提示词：${negative}`,
        '',
        '说明：以上内容由 mock-model-gateway 按规则合成，用于验证通道与业务链路，不是真实模型推理结果。',
      ].join('\n');
    }
  } else {
    const subject = pick(rng, SUBJECTS_EN);
    const color = pick(rng, COLORS_EN);
    const light = pick(rng, LIGHTS_EN);
    const composition = pick(rng, COMPOSITIONS_EN);
    const style = pick(rng, STYLES_EN);
    const negative = pick(rng, NEGATIVES_EN);
    if (imageCount > 0) {
      const reading = pick(rng, IMAGE_READINGS_EN);
      content = [
        '[SIMULATED IMAGE READING]',
        `${imageCount} input image(s) detected. The analysis below is template-based, not real vision inference.`,
        '',
        `Assessment: ${reading}.`,
        `Subject: ${subject}.`,
        `Colour: ${color}.`,
        '',
        'Suggested prompt:',
        `"${promptSummary}, ${style}, ${light}, ${composition}, ${color}, high detail"`,
        '',
        `Negative prompt: ${negative}`,
        '',
        'Note: generated by mock-model-gateway for channel and pipeline validation only.',
      ].join('\n');
    } else {
      content = [
        '[SIMULATED MODEL OUTPUT]',
        `Understood request: ${promptSummary}`,
        '',
        'Creative direction',
        `1. Subject: ${subject}.`,
        `2. Colour: ${color}.`,
        `3. Lighting: ${light}.`,
        `4. Composition: ${composition}.`,
        `5. Style: ${style}.`,
        '',
        'Prompt you can use directly:',
        `"${promptSummary}, ${style}, ${light}, ${composition}, ${color}, high detail"`,
        '',
        `Negative prompt: ${negative}`,
        '',
        'Note: rule-based output from mock-model-gateway for channel validation only; it is not real model inference.',
      ].join('\n');
    }
  }

  const promptTokens = estimateTokens(joined);
  const finished = clip(content, opts.maxTokens ?? 2048);
  const completionTokens = estimateTokens(finished);
  return {
    content: finished,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    detectedLanguage: lang,
    imageCount,
    finishReason: 'stop',
  };
}

/** 把文本切成若干 SSE 片段 —— 模拟流式输出用。 */
export function chunkForStreaming(text, size = 12) {
  const chars = [...String(text ?? '')];
  const chunks = [];
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(''));
  }
  return chunks.length ? chunks : [''];
}
