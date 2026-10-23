import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../common/app.exception';
import { SignedUrlService } from '../common/signed-url.service';

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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
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
    files: Array<{ filename: string; mimetype: string; data: Buffer }>,
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
    if (!files.length) {
      throw new AppError(40001, '图片内容为空', 400);
    }
    if (files.length > MAX_FILES) {
      throw new AppError(40001, `一次最多上传 ${MAX_FILES} 张`, 400);
    }

    /*
     * 写入前**再验一次项目归属**。
     *
     * 会话有效期 5 分钟, 期间项目可能已被删除或转移。写入时不复核,
     * 就会产生指向不存在项目的素材 (孤儿行), 或写进已经不属于该用户的
     * 项目里 —— 会话创建时校验过一次不能代替写入时校验。
     */
    const project = await this.prisma.project.findUnique({
      where: { id: s.projectId },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== s.ownerId) {
      s.status = 'expired';
      throw new AppError(41000, '目标项目已不存在，请在电脑端刷新后重试', 410);
    }

    // 逐张校验并落库; 任意一张不合法即整批失败 (不落半截数据)
    const prepared = files.map((file) => {
      if (!file.data?.length) {
        throw new AppError(40001, '图片内容为空', 400);
      }
      if (file.data.length > MAX_IMAGE_BYTES) {
        throw new AppError(40001, `单张不超过 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB`, 400);
      }
      const mime = sniffImageMime(file.data);
      if (!mime) {
        throw new AppError(40001, '仅支持 PNG / JPG / WEBP / GIF 图片', 400);
      }
      return { file, mime };
    });

    // 落存储: 走既有存储抽象层, 与网页上传同一条路径
    const provider = this.storage.getActive();
    const created: Array<{ id: string; url: string; signedUrl: string | null; filename: string }> = [];
    for (const { file, mime } of prepared) {
      const ext = extOf(mime);
      const key = this.storage.buildKey('original', ext);
      await provider.put(key, file.data, mime);
      const url = await provider.url(key);

      // 落素材表: 图片进入用户素材库, 与网页上传的素材同构
      const asset = await this.prisma.asset.create({
        data: {
          projectId: s.projectId,
          ownerId: s.ownerId,
          kind: 'original',
          sourceUrl: url,
          format: ext,
          sizeBytes: file.data.length,
          storageBackend: provider.backend,
          storageKey: key,
        },
      });
      // 与素材库同一条兼容策略：sourceUrl 给服务端内部用，signedUrl 给 <img>
      created.push({
        id: asset.id,
        url,
        signedUrl: this.signedUrl.sign(url, { userId: s.ownerId }),
        filename: file.filename || '手机上传图片',
      });
    }

    s.status = 'received';
    s.assets = created;
    // 兼容单张字段: 第一张同时写入 assetId/assetUrl (旧调用方仍可读)
    s.assetId = created[0]?.id ?? null;
    s.assetUrl = created[0]?.url ?? null;
    s.originalFilename = created[0]?.filename ?? null;
    this.log.log(
      `手机上传接收成功: session=${sessionId} 张数=${created.length} asset=${created.map((c) => c.id).join(',')}`,
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

/** 会话状态 */
export type MobileUploadStatus = 'waiting' | 'received' | 'expired';

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

/** 单张上限 20MB —— 与网页上传的 multer 限制一致 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** 一次最多上传张数 —— 参考站手机端是 3 列网格, 一次 6~9 张是常见量 */
const MAX_FILES = 9;

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
