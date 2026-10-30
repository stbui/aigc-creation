import {
  createTraceId,
  debugError,
  debugLog,
  describeUrl
} from "./debug-log.js";
import { requestForm } from "./api-client.js";
import { toAbsoluteUrl } from "./environment.js";
import {
  buildUploadFileName,
  prepareImageForUpload
} from "./image-normalizer.js";

/** 下载上限。超过这个体积的「原图」几乎都是印刷/打包图，不是采集目标 */
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const UPLOAD_PATH = "/assets/upload";

/**
 * 采集一张图片到站点素材库，返回素材 id 与可直接展示的地址。
 *
 * 全流程：下载原图 → 冻结动图首帧 → 转码/缩放到站点接受的格式
 * → multipart 上传（带分组与来源元数据）。
 *
 * 返回的 `url` 优先用 `signedUrl`（开启 `ASSET_SIGNING_SECRET` 时才有），
 * 并补成站点绝对地址 —— 本地存储后端返回的是 `/uploads/...` 相对路径，
 * 直接把相对路径交给采集页上的 `<img>` 会解析到对方站点域名上，必然破图。
 */
export async function uploadCapturedImage(
  imageUrl,
  { token, traceId: providedTraceId, projectId, source = {} } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const startedAt = Date.now();
  debugLog("asset-uploader", traceId, "开始采集上传", {
    imageUrl: describeUrl(imageUrl),
    projectId,
    tokenLength: typeof token === "string" ? token.length : 0
  });

  if (typeof token !== "string" || !token) {
    throw new Error("上传缺少用户令牌。");
  }
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("上传缺少目标分组。");
  }

  try {
    const downloaded = await downloadImage(imageUrl, traceId);
    const prepared = await prepareImageForUpload(downloaded);

    const form = new FormData();
    form.append("file", prepared.blob, buildUploadFileName(prepared.blob.type));
    form.append("projectId", projectId);
    appendOptional(form, "sourceSite", source.sourceSite);
    appendOptional(form, "sourceTitle", source.sourceTitle);
    appendOptional(form, "sourcePageUrl", source.sourcePageUrl);

    const { data, requestId } = await requestForm(UPLOAD_PATH, form, {
      token,
      traceId,
      scope: "asset-uploader"
    });
    const assetId = normalizeAssetId(data?.id);
    const url = toAbsoluteUrl(
      typeof data?.signedUrl === "string" && data.signedUrl
        ? data.signedUrl
        : data?.sourceUrl
    );

    if (!assetId || !url) {
      throw new Error("图片已上传，但接口未返回素材地址。");
    }

    debugLog("asset-uploader", traceId, "采集上传完成", {
      assetId,
      durationMs: Date.now() - startedAt,
      projectId: data?.projectId || projectId,
      requestId,
      resultUrl: describeUrl(url),
      size: prepared.blob.size,
      sourceMimeType: downloaded.type || null,
      uploadedMimeType: prepared.blob.type || null
    });

    return {
      assetId,
      url,
      projectId: normalizeAssetId(data?.projectId) || projectId,
      width: Number.isFinite(data?.width) ? data.width : prepared.width,
      height: Number.isFinite(data?.height) ? data.height : prepared.height
    };
  } catch (error) {
    debugError("asset-uploader", traceId, "采集上传失败", error, {
      durationMs: Date.now() - startedAt,
      imageUrl: describeUrl(imageUrl)
    });
    throw error;
  }
}

async function downloadImage(imageUrl, traceId) {
  const url = parseImageUrl(imageUrl);
  const startedAt = Date.now();
  debugLog("asset-uploader", traceId, "开始下载原图", {
    imageUrl: describeUrl(url.href)
  });

  let response;
  try {
    // 采集页常把图片放在登录态后面（小红书/淘宝 CDN），必须带上页面 Cookie
    response = await fetchWithTimeout(url.href, { credentials: "include" }, 60000);
  } catch (error) {
    throw new Error(`下载原图失败：${error instanceof Error ? error.message : "网络异常"}`);
  }

  debugLog("asset-uploader", traceId, "原图下载响应", {
    contentLength: Number(response.headers.get("content-length")) || null,
    contentType: response.headers.get("content-type"),
    durationMs: Date.now() - startedAt,
    status: response.status
  });

  if (!response.ok) {
    throw new Error(`下载原图失败（HTTP ${response.status}）。`);
  }

  assertDownloadSize(Number(response.headers.get("content-length")));
  const blob = await response.blob();
  assertDownloadSize(blob.size);

  if (!isImageBlob(blob, url)) {
    throw new Error("该地址返回的内容不是图片。");
  }

  debugLog("asset-uploader", traceId, "原图下载完成", {
    mimeType: blob.type || null,
    size: blob.size
  });
  return blob;
}

function parseImageUrl(imageUrl) {
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("图片地址无效。");
  }

  // data: 用于画布类站点（图片以 base64 内联）；blob: 在 Service Worker 里取不到
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new Error("暂不支持采集此类型的图片地址。");
  }

  return url;
}

function assertDownloadSize(size) {
  if (Number.isFinite(size) && size > MAX_DOWNLOAD_BYTES) {
    throw new Error("图片超过 30MB，请尝试采集页面上更小的那张图。");
  }
}

function isImageBlob(blob, url) {
  const mimeType = String(blob.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  // 部分 CDN 返回 application/octet-stream，只能靠路径后缀兜底
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i.test(url.pathname);
}

function appendOptional(form, key, value) {
  if (typeof value === "string" && value.trim()) {
    form.append(key, value.trim());
  }
}

function normalizeAssetId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("下载超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
