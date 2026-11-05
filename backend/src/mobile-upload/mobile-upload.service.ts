import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../common/app.exception';
import { SignedUrlService } from '../common/signed-url.service';
import {
  inspectUploadedImage,
  maxUploadBytes,
  verifyDecodableImage,
} from '../assets/image-validation';

/**
 * 手机上传会话服务 —— 参考站「手机上传」的会话侧。
 *
 * ## 交互模型 (取自参考站实拍与前端 bundle 埋点)
 *
 *   电脑端点「手机上传」 → 生成二维码 (埋点 mobile-upload-open)
 *   二维码就绪            → (埋点 mobile-upload-qr-ready)
 *   手机扫码打开页面      → 选图/拍照, 前端压缩 (埋点 mobile-upload-compressed)
 *   电脑端轮询到图片      → (埋点 mobile-upload-received) 图片进入参考图位
 *   超过有效期            → (埋点 mobile-upload-expired) 「二维码已失效, 请在电脑端刷新」
 *   主动关闭              → (埋点 mobile-upload-cancel)
 *
 * ## 为什么用内存 Map 而不是建表
 *
 * 会话是**分钟级临时对象**: 二维码本身就有有效期, 会话存在的唯一目的是
 * 在这段时间里把"手机端的一次上传"和"电脑端的一次轮询"对上号。
 * 落库会带来三个成本 —— 建表/迁移、清理过期行、以及一个几乎立刻变成垃圾的表。
 *
 * ⚠️ **代价要说清**: 会话只存在于**单个后端进程**内。
 * 多实例部署时, 轮询请求若被负载均衡打到另一实例, 会读不到会话 (返回 404)。
 * 本项目当前是单实例 (docker-compose 单容器), 故可接受;
 * 若将来水平扩展, 需把本服务换成 Redis 等共享存储 —— 接口形状不必变。
 */
@Injectable()
export class MobileUploadService {
  private readonly log = new Logger(MobileUploadService.name);

  /** 会话表。key = sessionId */
  private readonly sessions = new Map<string, MobileUploadSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly signedUrl: SignedUrlService,
  ) {}

  /**
   * 创建会话。
   *
   * @param ownerId 电脑端用户 —— 手机端上传的图片会落到他的素材库
   * @param projectId 图片归属的项目。**必须是 ownerId 自己的项目**
   *
   * ⚠ 归属校验不能省 (2026-10-21 修): 此前只检查 projectId 非空, 任何人都能
   * 传别人的 projectId 建会话, 再凭令牌把图片写进**别人的项目**。
   * 手机端上传不需要登录, 令牌是唯一凭证 —— 会话创建就是权限边界的入口。
   */
  async create(ownerId: string, projectId: string): Promise<MobileUploadSession> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== ownerId) {
      // 与「不存在」同一口径: 不泄露"这个项目 id 存在但不属于你"
      throw new AppError(40400, '项目不存在或无权限', 404);
    }

    const now = Date.now();
    const session: MobileUploadSession = {
      id: randomUUID(),
      /**
       * 上传令牌 —— 手机端**不登录**, 凭此令牌上传。
       * 必须是密码学随机的: 猜到它就能往别人账号里塞图。
       */
      token: randomBytes(24).toString('base64url'),
      ownerId,
      projectId,
      status: 'waiting',
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      assets: [],
      assetId: null,
      assetUrl: null,
      originalFilename: null,
    };
    this.sessions.set(session.id, session);
    this.sweepExpired();
    return session;
  }

  /** 电脑端轮询会话状态 */
  status(ownerId: string, sessionId: string): MobileUploadSession {
    const s = this.mustGet(sessionId);
    if (s.ownerId !== ownerId) {
      // 不泄露"存在但不属于你" —— 统一按不存在处理
      throw new AppError(40400, '上传会话不存在', 404);
    }
    if (s.status === 'waiting' && Date.now() > s.expiresAt) {
      s.status = 'expired';
    }
    return s;
  }

  /** 电脑端取消会话 (关掉弹窗) */
  cancel(ownerId: string, sessionId: string): void {
    const s = this.mustGet(sessionId);
    if (s.ownerId !== ownerId) {
      throw new AppError(40400, '上传会话不存在', 404);
    }
    this.sessions.delete(sessionId);
  }

  /**
   * 手机端上传图片 —— **凭令牌鉴权, 不需要登录**。
   *
   * 手机是另一台设备, 强制它登录会把"扫码即用"变成"扫码先注册"。
   * 令牌即授权: 它由电脑端登录用户在自己的会话里生成, 且短时有效。
   *
   * ## 支持一次多张 (2026-10-20, 对齐参考站)
   *
   * 参考站手机端是 3 列网格, 可一次选多张并**排序**后「确认上传」。
   * 故本方法收 `files` 数组, 逐张落库, 返回全部 assetId ——
   * 电脑端轮询到后一次性回填多张到参考图位。
   *
   * ⚠️ 顺序即构图顺序: 参考站的排序箭头决定图片在参考图位的前后次序,
   * 故这里**按数组顺序**创建素材, 电脑端按 assetIds 顺序回填。
   */
  async receive(
    sessionId: string,
    token: string,
    files: MobileUploadInputFile[],
  ): Promise<MobileUploadSession> {
    const s = this.mustGet(sessionId);
    if (s.token !== token) {
      throw new AppError(40300, '上传令牌无效', 403);
    }
    if (Date.now() > s.expiresAt) {
      s.status = 'expired';
      throw new AppError(41000, '二维码已失效，请在电脑端刷新', 410);
    }
    if (s.status === 'received') {
      throw new AppError(40900, '该会话已接收过图片', 409);
    }
    if (s.status === 'receiving') {
      throw new AppError(40900, '该会话正在接收图片，请勿重复提交', 409);
    }
    if (s.status !== 'waiting') {
      throw new AppError(41000, '二维码已失效，请在电脑端刷新', 410);
    }
    if (!files.length) {
      throw new AppError(40001, '图片内容为空', 400);
    }
    if (files.length > MOBILE_UPLOAD_MAX_FILES) {
      throw new AppError(40001, `一次最多上传 ${MOBILE_UPLOAD_MAX_FILES} 张`, 400);
    }

    // 这段状态切换发生在第一个 await 之前，形成会话内 CAS：并发提交的第二个
    // 请求会看到 receiving，不会把同一会话写出两套素材。
    s.status = 'receiving';
    try {
      return await this.receiveClaimed(s, files);
    } catch (error) {
      if (s.status === 'receiving') {
        s.status = error instanceof AppError && error.code === 41000 ? 'expired' : 'waiting';
      }
      throw error;
    }
  }

  private async receiveClaimed(
    s: MobileUploadSession,
    files: MobileUploadInputFile[],
  ): Promise<MobileUploadSession> {
    const declaredTotal = files.reduce((sum, file) => sum + Math.max(0, file.size ?? 0), 0);
    if (declaredTotal > MOBILE_UPLOAD_MAX_TOTAL_BYTES) {
      throw new AppError(
        40001,
        `一次上传总大小不能超过 ${Math.floor(MOBILE_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024)}MB`,
        400,
      );
    }

    /*
     * 写入前**再验一次项目归属**。
     *
     * 会话有效期 5 分钟, 期间项目可能已被删除或转移。写入时不复核,
     * 就会产生指向不存在项目的素材 (孤儿行), 或写进已经不属于该用户的
     * 项目里 —— 会话创建时校验过一次不能代替写入时校验。
     */
    const project = await this.prisma.project.findFirst({
      where: { id: s.projectId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== s.ownerId) {
      s.status = 'expired';
      throw new AppError(41000, '目标项目已不存在，请在电脑端刷新后重试', 410);
    }

    // 先逐张完整校验，全部通过后才开始写对象存储，避免半批素材入库。
    // 每个 buffer 校验后即释放，不把 9 张手机原图同时留在内存里。
    const prepared: Array<{
      file: MobileUploadInputFile;
      mime: string;
      ext: string;
      width: number;
      height: number;
      sizeBytes: number;
    }> = [];
    let actualTotal = 0;
    for (const file of files) {
      const data = await readUploadFile(file);
      if (!data.length) throw new AppError(40001, '图片内容为空', 400);
      actualTotal += data.length;
      if (actualTotal > MOBILE_UPLOAD_MAX_TOTAL_BYTES) {
        throw new AppError(
          40001,
          `一次上传总大小不能超过 ${Math.floor(MOBILE_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024)}MB`,
          400,
        );
      }
      if (data.length > maxUploadBytes()) {
        throw new AppError(
          40001,
          `单张不超过 ${Math.floor(maxUploadBytes() / 1024 / 1024)}MB`,
          400,
        );
      }
      // 不信任扩展名和客户端 mimetype：文件头判真实格式，再完整解码一次，
      // 防止只有 PNG 魔数但像素数据损坏的“伪图”进入素材库。
      const info = inspectUploadedImage(data, { maxBytes: maxUploadBytes() });
      await verifyDecodableImage(data, info);
      prepared.push({
        file,
        mime: info.mime,
        ext: info.ext,
        width: info.width,
        height: info.height,
        sizeBytes: data.length,
      });
    }

    // 落存储: 走既有存储抽象层, 与网页上传同一条路径
    const provider = this.storage.getActive();
    const storedFiles: Array<{
      key: string;
      url: string;
      ext: string;
      mime: string;
      width: number;
      height: number;
      sizeBytes: number;
      file: MobileUploadInputFile;
    }> = [];
    let created: Array<{ id: string; url: string; signedUrl: string | null; filename: string }>;
    try {
      for (const item of prepared) {
        if (this.sessions.get(s.id) !== s) {
          throw new AppError(40900, '上传会话已取消', 409);
        }
        const data = await readUploadFile(item.file);
        if (data.length !== item.sizeBytes) {
          throw new AppError(40001, '上传文件在接收过程中发生变化，请重新上传', 400);
        }
        const key = this.storage.buildKey('original', item.ext);
        await provider.put(key, data, item.mime);
        const url = await provider.url(key);
        storedFiles.push({ key, url, ...item });
      }

      if (this.sessions.get(s.id) !== s) {
        throw new AppError(40900, '上传会话已取消', 409);
      }

      const assets = await this.prisma.$transaction(async (tx) => {
        // 文件写入/转码期间项目仍可能被后台软删；项目复核与素材落库同事务，
        // 避免在删除事务之后又写入一批 visible 素材。
        const activeProject = await tx.project.findFirst({
          where: { id: s.projectId, ownerId: s.ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!activeProject) {
          throw new AppError(41000, '目标项目已不存在，请在电脑端刷新后重试', 410);
        }

        const rows = [];
        for (const stored of storedFiles) {
          // 落素材表: 图片进入用户素材库, 与网页上传的素材同构
          rows.push(
            await tx.asset.create({
              data: {
                projectId: s.projectId,
                ownerId: s.ownerId,
                kind: 'original',
                sourceUrl: stored.url,
                format: stored.mime,
                sizeBytes: stored.sizeBytes,
                width: stored.width,
                height: stored.height,
                storageBackend: provider.backend,
                storageKey: stored.key,
              },
            }),
          );
        }
        return rows;
      });

      created = assets.map((asset, index) => {
        const stored = storedFiles[index];
        return {
          id: asset.id,
          url: stored.url,
          signedUrl: this.signedUrl.sign(stored.url, { userId: s.ownerId }),
          filename: stored.file.filename || '手机上传图片',
        };
      });
    } catch (error) {
      // 事务失败时清掉刚写入的对象，避免在已删项目之外再留下无主文件。
      await Promise.all(
        storedFiles.map((stored) => provider.delete(stored.key).catch(() => undefined)),
      );
      if (error instanceof AppError && error.code === 41000) s.status = 'expired';
      throw error;
    }

    s.status = 'received';
    s.assets = created;
    // 兼容单张字段: 第一张同时写入 assetId/assetUrl (旧调用方仍可读)
    s.assetId = created[0]?.id ?? null;
    s.assetUrl = created[0]?.url ?? null;
    s.originalFilename = created[0]?.filename ?? null;
    this.log.log(
      `手机上传接收成功: session=${s.id} 张数=${created.length} asset=${created.map((c) => c.id).join(',')}`,
    );
    return s;
  }

  /** 取会话; 不存在或已过期则抛错 */
  private mustGet(sessionId: string): MobileUploadSession {
    const s = this.sessions.get(sessionId);
    if (!s) {
      throw new AppError(40400, '上传会话不存在或已失效', 404);
    }
    return s;
  }

  /** 清理过期会话, 防止 Map 无限增长 */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      // 保留已接收的会话一小段时间, 让电脑端最后一轮轮询能读到结果
      if (now > s.expiresAt + KEEP_AFTER_EXPIRE_MS) this.sessions.delete(id);
    }
  }
}

/** 手机端上传文件 —— 生产路径由 multer 落临时盘，测试可直接传内存 buffer。 */
export interface MobileUploadInputFile {
  filename: string;
  mimetype: string;
  size?: number;
  path?: string;
  data?: Buffer;
}

/** 会话状态 */
export type MobileUploadStatus = 'waiting' | 'receiving' | 'received' | 'expired';

export interface MobileUploadSession {
  id: string;
  /** 手机端上传令牌 —— **只在创建时返回一次, 之后不再返回** */
  token: string;
  ownerId: string;
  projectId: string;
  status: MobileUploadStatus;
  createdAt: number;
  expiresAt: number;
  /**
   * 已接收的素材列表 (2026-10-20 起支持一次多张, 对齐参考站手机端)。
   *
   * **顺序即构图顺序** —— 参考站手机端可排序, 电脑端按此顺序回填参考图位。
   */
  assets: Array<{ id: string; url: string; signedUrl: string | null; filename: string }>;
  /**
   * 兼容字段: 第一张素材的 id / url / 文件名。
   *
   * ⚠️ 保留是为了不打断单张场景的既有读取方 (含既有验证脚本);
   * 新代码应读 `assets` 数组。
   */
  assetId: string | null;
  /**
   * 素材的可访问地址。
   *
   * ⚠️ **必须由后端给出**: 前端拿到的 assetId 是数据库主键, 不是存储 key,
   * 拼不出 `/uploads/...` 这个地址 (存储 key 是 `original/202610/xxx.jpg` 形态)。
   * 由后端在写入时一并记下, 避免前端猜地址规则。
   */
  assetUrl: string | null;
  originalFilename: string | null;
}

/** 会话有效期 (毫秒) —— 二维码 5 分钟有效 */
const SESSION_TTL_MS = 5 * 60 * 1000;

/** 过期后再保留一会儿, 让电脑端最后一轮轮询能读到结果 */
const KEEP_AFTER_EXPIRE_MS = 60 * 1000;

/** 一次最多上传张数 —— 参考站手机端是 3 列网格, 一次 6~9 张是常见量 */
export const MOBILE_UPLOAD_MAX_FILES = 9;

/** 整批上限 60MB：单张另有全站统一的 10MB 上限。 */
export const MOBILE_UPLOAD_MAX_TOTAL_BYTES = 60 * 1024 * 1024;

async function readUploadFile(file: MobileUploadInputFile): Promise<Buffer> {
  if (file.data !== undefined) return file.data;
  if (!file.path) throw new AppError(40001, '上传文件路径缺失', 400);
  return readFile(file.path);
}

/**
 * 按字节魔数判定图片类型。
 *
 * ⚠️ 不看文件名扩展名: 手机拍照上传的文件名可能是 `IMG_001` (无扩展名) 或
 * `image` (伪扩展名)。只看后缀会把 PNG 当成 JPEG 处理, 模型侧可能拒收。
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  return null;
}

/** MIME → 扩展名 */
function extOf(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}
