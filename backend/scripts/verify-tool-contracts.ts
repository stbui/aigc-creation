/**
 * 8 个修图工具的参考站契约回归（2026-10-25）。
 *
 * 这些页面此前各自演进，最容易出现「界面能点，但隐藏字段在落库前被默认值
 * 覆盖」「前后端枚举不一致」「上传只看扩展名」三类问题。本脚本不依赖服务，
 * 直接对能力注册表、参数闸口和图片头校验做断言，作为 L2 闸口。
 */
import { Jimp, JimpMime } from 'jimp';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getCapability,
  sanitizeParams,
  validateCapabilityParams,
} from '../src/capabilities/capability.registry';
import { parseLocalRedrawAnnotations } from '../src/capabilities/definitions/local_redraw';
import { buildPromptFor } from '../src/providers/gateway-prompt';
import {
  inspectMaskImage,
  inspectUploadedImage,
  verifyDecodableImage,
} from '../src/assets/image-validation';
import { AppError } from '../src/common/app.exception';
import { AssetsService } from '../src/assets/assets.service';

let pass = 0;
const fails: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  fails.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

function throwsAppError(fn: () => unknown, expectedCode = 40001): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof AppError && error.code === expectedCode;
  }
}

const TOOL_IDS = [
  'local_redraw',
  'matting',
  'remove_watermark',
  'enhance',
  'image_translate',
  'expand',
  'recolor',
  'rotate',
];

async function main() {
console.log('\n【8 个修图工具能力定义】');
for (const id of TOOL_IDS) {
  const def = getCapability(id);
  check(`${id} 已注册且可提交`, Boolean(def && def.mode !== 'planned'));
  check(`${id} 声明恰好 1 张输入`, def?.inputs === 1, def?.inputs);
  check(`${id} 声明图像模态`, def?.modality === 'image', def?.modality);
  check(
    `${id} 只走模型生成`,
    Boolean(def) &&
      !Object.prototype.hasOwnProperty.call(def, 'localImpl') &&
      !Object.prototype.hasOwnProperty.call(def, 'localFallback'),
  );
}

console.log('\n【参考站关键字段与默认值】');
const matting = getCapability('matting');
const mattingSelected = matting?.params.find((p) => p.key === 'selectedColor');
const mattingAlpha = matting?.params.find((p) => p.key === 'customAlpha');
check('抠图 selectedColor 为隐藏枚举且默认透明', mattingSelected?.hidden === true && mattingSelected?.default === 'transparent', mattingSelected);
check('抠图 customAlpha 为 0..100 数字', mattingAlpha?.type === 'number' && mattingAlpha.min === 0 && mattingAlpha.max === 100, mattingAlpha);

const translate = getCapability('image_translate');
check(
  '翻译默认简体中文且保护主体',
  translate?.params.find((p) => p.key === 'targetLang')?.default === 'zh-CN' &&
    translate?.params.find((p) => p.key === 'targetLanguage')?.default === 'zh-CN' &&
    translate?.params.find((p) => p.key === 'protectSubject')?.default === true,
);
check(
  '翻译不再声明本地生成实现',
  Boolean(translate) &&
    !Object.prototype.hasOwnProperty.call(translate, 'localImpl') &&
    !Object.prototype.hasOwnProperty.call(translate, 'localFallback'),
);

const expand = getCapability('expand');
check(
  '扩图默认占比 80%、居中、范围 1..100',
  expand?.params.find((p) => p.key === 'occupy')?.default === 80 &&
    expand?.params.find((p) => p.key === 'occupy')?.min === 1 &&
    expand?.params.find((p) => p.key === 'occupy')?.max === 100 &&
    expand?.params.find((p) => p.key === 'position')?.default === 'center',
);
check(
  '扩图精确定位字段是 hidden',
  ['placementX', 'placementY', 'placementWidth', 'placementHeight', 'targetImageRatio'].every(
    (key) => expand?.params.find((p) => p.key === key)?.hidden === true,
  ),
);

const rotate = getCapability('rotate');
check(
  '旋转三轴默认值与范围正确',
  rotate?.params.find((p) => p.key === 'yaw')?.default === 0 &&
    rotate?.params.find((p) => p.key === 'pitch')?.min === -30 &&
    rotate?.params.find((p) => p.key === 'pitch')?.max === 60 &&
    rotate?.params.find((p) => p.key === 'zoom')?.default === 1,
);
check(
  '旋转参考站字段全部 hidden',
  ['azimuthDeg', 'elevationDeg', 'zoomFactor', 'imageRatio'].every(
    (key) => rotate?.params.find((p) => p.key === key)?.hidden === true,
  ),
);

const watermark = getCapability('remove_watermark');
check(
  '去水印遮罩/检测方式/输出格式已声明',
  ['maskAssetId', 'detectionMode', 'outputFormat'].every(
    (key) => watermark?.params.some((p) => p.key === key),
  ),
);
check(
  '去水印检测方式默认 MANUAL',
  watermark?.params.find((p) => p.key === 'detectionMode')?.default === 'MANUAL',
);

const redraw = getCapability('local_redraw');
check(
  '局部重绘不再声明本地生成实现',
  Boolean(redraw) &&
    !Object.prototype.hasOwnProperty.call(redraw, 'localImpl') &&
    !Object.prototype.hasOwnProperty.call(redraw, 'localFallback'),
);
check(
  '局部重绘遮罩与标注字段已声明',
  ['maskAssetId', 'modelGuideAssetId', 'annotations', 'strength', 'outputCount'].every(
    (key) => redraw?.params.some((p) => p.key === key),
  ),
);
check(
  '局部重绘输出固定 1 张',
  redraw?.params.find((p) => p.key === 'outputCount')?.min === 1 &&
    redraw?.params.find((p) => p.key === 'outputCount')?.max === 1,
);

const enhance = getCapability('enhance');
check(
  '精修模板码与参考站补充要求字段已声明',
  enhance?.params.find((p) => p.key === 'templateCode')?.hidden === true &&
    enhance?.params.find((p) => p.key === 'additionalRequirement')?.hidden === true,
);
const recolor = getCapability('recolor');
check('换色目标 HEX 字段已声明', recolor?.params.find((p) => p.key === 'targetColor')?.hidden === true);
check(
  'HEX 字段携带后端格式约束',
  recolor?.params.find((p) => p.key === 'customColor')?.pattern === '^#[0-9a-fA-F]{6}$' &&
    getCapability('matting')?.params.find((p) => p.key === 'customColor')?.pattern === '^#[0-9a-fA-F]{6}$',
);
check(
  '换色预设色进入提示词',
  buildPromptFor('recolor', sanitizeParams('recolor', { color: '#82CEF3' })).includes('#82CEF3'),
);
check(
  '换色兼容 customColor 进入提示词',
  buildPromptFor('recolor', sanitizeParams('recolor', { color: 'custom', customColor: '#7B2FF7' })).includes(
    '#7B2FF7',
  ),
);
check(
  '换色 targetColor 优先于兼容字段',
  buildPromptFor(
    'recolor',
    sanitizeParams('recolor', { color: 'custom', customColor: '#7B2FF7', targetColor: '#FF0B22' }),
  ).includes('#FF0B22'),
);

console.log('\n【hidden 字段兼容：未提交不得注入默认值】');
const oldMatting = sanitizeParams('matting', { bgColor: '#3988E9' });
check('旧抠图调用不注入 selectedColor', !('selectedColor' in oldMatting), oldMatting);
const oldRotate = sanitizeParams('rotate', { yaw: 20, pitch: 5, zoom: 1 });
check('旧旋转调用不注入参考站字段', !('azimuthDeg' in oldRotate) && !('zoomFactor' in oldRotate), oldRotate);
const oldExpand = sanitizeParams('expand', { occupy: 80, position: 'center' });
check('旧扩图调用不注入精确定位', !('placementX' in oldExpand) && !('placementWidth' in oldExpand), oldExpand);
const oldEnhance = sanitizeParams('enhance', { mode: 'color' });
check('旧精修调用不注入 templateCode', !('templateCode' in oldEnhance), oldEnhance);

console.log('\n【参数严格校验：越界/错枚举在扣费前拒绝】');
check('扩图占比 120 被拒', throwsAppError(() => validateCapabilityParams('expand', { occupy: 120 })));
check('扩图占比 0 被拒', throwsAppError(() => validateCapabilityParams('expand', { occupy: 0 })));
check('扩图占比 100 通过', !throwsAppError(() => validateCapabilityParams('expand', { occupy: 100 })));
check('旋转缩放 2 被拒', throwsAppError(() => validateCapabilityParams('rotate', { zoom: 2 })));
check('旋转方位角 -91 被拒', throwsAppError(() => validateCapabilityParams('rotate', { azimuthDeg: -91 })));
check('抠图非法枚举被拒', throwsAppError(() => validateCapabilityParams('matting', { selectedColor: 'pink' })));
check(
  '抠图非法 HEX 被拒',
  throwsAppError(() => validateCapabilityParams('matting', { selectedColor: 'custom', customColor: 'red' })),
);
check(
  '换色非法目标 HEX 被拒',
  throwsAppError(() => validateCapabilityParams('recolor', { targetColor: '#12GG34' })),
);
check('合法 HEX 通过', !throwsAppError(() => validateCapabilityParams('recolor', { targetColor: '#7B2FF7' })));
check(
  '换色自定义色缺少 HEX 被拒',
  throwsAppError(() => validateCapabilityParams('recolor', { color: 'custom' })),
);
check(
  '换色兼容自定义色通过',
  !throwsAppError(() => validateCapabilityParams('recolor', { color: 'custom', customColor: '#7B2FF7' })),
);
check('布尔字段传中文被拒', throwsAppError(() => validateCapabilityParams('image_translate', { protectSubject: '是' })));
check('合法参数通过', !throwsAppError(() => validateCapabilityParams('expand', { occupy: 80, position: 'center' })));

console.log('\n【局部重绘标注解析】');
const parsed = parseLocalRedrawAnnotations(
  JSON.stringify([
    { annotationId: 'a', label: '区域A', instruction: '换成蓝色', referenceAssetId: 'asset-1' },
    { annotationId: 'b', label: '区域B', instruction: '  ' },
    { annotationId: 'c', label: '区域C', instruction: '增加阴影' },
  ]),
);
check('丢弃空描述并保留有效标注', parsed.length === 2 && parsed[0].referenceAssetId === 'asset-1', parsed);
check('最多保留 3 条标注', parseLocalRedrawAnnotations(JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ instruction: `要求${i}` })))).length === 3);
check('坏 JSON 不抛异常', parseLocalRedrawAnnotations('{not-json').length === 0);
check('数字 instruction 不抛异常', parseLocalRedrawAnnotations(JSON.stringify([{ instruction: 123 }])).length === 0);

console.log('\n【上传图片按真实格式与像素校验】');
const image = new Jimp({ width: 64, height: 48, color: 0x336699ff });
const png = await image.getBuffer(JimpMime.png);
const jpeg = await image.getBuffer(JimpMime.jpeg);
const pngInfo = inspectUploadedImage(png);
check('PNG 魔数与尺寸被正确识别', pngInfo.mime === 'image/png' && pngInfo.width === 64 && pngInfo.height === 48, pngInfo);
const jpegInfo = inspectUploadedImage(jpeg);
check('JPEG 魔数与尺寸被正确识别', jpegInfo.mime === 'image/jpeg' && jpegInfo.width === 64 && jpegInfo.height === 48, jpegInfo);
check('伪装的 HTML 被拒', throwsAppError(() => inspectUploadedImage(Buffer.from('<html>not an image</html>'))));
check('伪装成 .png 的文本被拒', throwsAppError(() => inspectUploadedImage(Buffer.from('not-a-real-png'))));
check('超过 40MP 的图片头被拒', throwsAppError(() => {
  const bomb = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bomb, 0);
  bomb.writeUInt32BE(13, 8);
  bomb.write('IHDR', 12, 'ascii');
  bomb.writeUInt32BE(10_000, 16);
  bomb.writeUInt32BE(10_000, 20);
  inspectUploadedImage(bomb);
}));
check('遮罩与原图同尺寸通过', inspectMaskImage(png, { width: 64, height: 48 }).mime === 'image/png');
check('遮罩与原图尺寸不一致被拒', throwsAppError(() => inspectMaskImage(png, { width: 100, height: 100 })));
check('遮罩必须为 PNG', throwsAppError(() => inspectMaskImage(jpeg, { width: 64, height: 48 })));
const badPng = Buffer.from(png);
badPng[badPng.length - 20] ^= 0xff;
let corruptRejected = false;
try {
  await verifyDecodableImage(badPng, { width: 64, height: 48 });
} catch (error) {
  corruptRejected = error instanceof AppError && error.code === 40001;
}
check('文件头合法但像素损坏仍被拒', corruptRejected);

console.log('\n【上传失败不留无主临时文件】');
const previousUploadDir = process.env.UPLOAD_DIR;
const tempUploadDir = await mkdtemp(join(tmpdir(), 'aigc-upload-cleanup-'));
try {
  process.env.UPLOAD_DIR = tempUploadDir;
  await mkdir(join(tempUploadDir, 'original'), { recursive: true });
  const tempName = 'invalid-project.png';
  const tempFile = join(tempUploadDir, 'original', tempName);
  await writeFile(tempFile, png);
  const service = new AssetsService(
    { project: { findUnique: async () => null } } as never,
    {} as never,
    {} as never,
  );
  let projectRejected = false;
  try {
    await service.createOriginal('owner-1', 'missing-project', {
      filename: tempName,
      originalname: 'upload.png',
      size: png.length,
      mimetype: 'image/png',
    });
  } catch (error) {
    projectRejected = error instanceof AppError && error.code === 40001;
  }
  let tempExists = true;
  await access(tempFile).catch(() => {
    tempExists = false;
  });
  check('非法项目被拒且临时文件已清理', projectRejected && !tempExists);
} finally {
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  await rm(tempUploadDir, { recursive: true, force: true });
}

console.log(`\n通过 ${pass} 项 / 失败 ${fails.length} 项`);
if (fails.length) {
  console.error('\n失败明细:');
  for (const item of fails) console.error(`  ✗ ${item}`);
  process.exit(1);
}
console.log('8 个修图工具契约验证通过');
}

void main().catch((error) => {
  console.error('8 个修图工具契约验证异常:', error);
  process.exit(1);
});
