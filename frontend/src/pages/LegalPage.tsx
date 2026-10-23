import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ExceptionPage } from '../components/ExceptionPage';
import { StateLoading } from '../components/StateViews';
import { legalApi } from '../lib/api';
import type { LegalDoc as RemoteLegalDoc } from '../types/api';

/**
 * 法务文本页 —— 复刻参考站 /legal/*.html 的**文档版式**（数据驱动，三份文档共用一套渲染）。
 *
 * 参考站实测版式（2026-10-17, privacy-policy.html）:
 *   白色底, 文档列 744px (@x64), `.WordSection1`
 *   标题 h2 28px/700 #171A2B lh39.2
 *   导语段 21px lh29.4 #171A2B
 *   正文段 15px lh27.75 #4B5874
 *
 * 诚实差异: 参考站三份法务文本是以「深圳市科极灵径科技有限公司」为主体的正式协议，
 * 逐字照搬会构成本项目由该公司运营的法律声明，故**只复刻版式**、正文使用本项目模板文本，
 * 并在页首明示「尚未经法务审阅」。正式对外前需由法务出具正式文本并经后台发布。
 */

interface LegalDoc {
  slug: string;
  title: string;
  lead: string;
  sections: { heading: string; paragraphs: string[] }[];
}

const DOCS: Record<string, LegalDoc> = {
  'user-agreement': {
    slug: 'user-agreement',
    title: '用户协议',
    lead: '本协议是货觉AI 与使用者之间的使用约定模板，运营主体以实际部署方登记为准。',
    sections: [
      {
        heading: '第一条 协议主体与效力',
        paragraphs: [
          '本平台由实际部署方运营，运营主体信息以部署方登记为准。使用者指自愿注册、登录并使用本平台服务的个人或企业。',
          '使用者勾选同意并开始使用，视为已阅读并接受本协议全部条款。',
        ],
      },
      {
        heading: '第二条 服务内容',
        paragraphs: [
          '本平台提供电商图片生成与处理能力，包括商品主图、商品详情图、爆款复刻、局部重绘、一键抠图、去水印、产品精修、图片翻译、智能扩图、商品换色、旋转角度等工具。',
          '产出由云端模型或本地算法完成，页面按单次请求的实际通道如实标注「真实模型」或「本地算法」。',
        ],
      },
      {
        heading: '第三条 使用规范',
        paragraphs: [
          '使用者不得上传侵犯他人著作权、商标权或肖像权的素材；不得利用本平台生成违法、虚假或误导性商品信息。',
          '因上传素材引发的争议由上传方自行承担，与平台运营方无关。',
        ],
      },
      {
        heading: '第四条 免责声明',
        paragraphs: [
          '本项目按「现状」提供，不对生成结果的商业适用性、点击率或转化效果作任何明示或暗示的保证。',
          '接入真实模型后，生成质量与模型能力、输入素材质量相关，平台不承担间接损失。',
        ],
      },
    ],
  },
  'privacy-policy': {
    slug: 'privacy-policy',
    title: '个人信息保护政策',
    lead: '本政策说明货觉AI 如何处理使用者提供的信息。',
    sections: [
      {
        heading: '第一条 我们收集的信息',
        paragraphs: [
          '账号信息：邮箱地址、昵称、登录令牌；启用短信登录时另含经验证的手机号。',
          '业务信息：上传的原始素材、生成的图片、任务记录与参数配置。',
        ],
      },
      {
        heading: '第二条 信息的使用',
        paragraphs: [
          '上述信息仅用于完成图片生成、作品展示与数据统计，不用于对外提供或商业化使用。',
          '工作台卡片缩略图取自使用者自己的真实产出，不使用他人素材。',
        ],
      },
      {
        heading: '第三条 存储与删除',
        paragraphs: [
          '素材与生成图保存在平台配置的存储后端（服务器本地磁盘或对象存储），通过签名地址访问。',
          '使用者可在「我的作品」与「素材库」中删除任务与素材，删除会同步清理磁盘文件。',
        ],
      },
      {
        heading: '第四条 共享与披露',
        paragraphs: [
          '仅在完成服务所必需的范围内共享：支付渠道（收款与退款）、邮件与短信服务商（验证码与通知）、模型服务商与云存储（生成与保存素材）。上述服务商仅能在履约所需范围内处理数据。',
        ],
      },
    ],
  },
  'account-rules': {
    slug: 'account-rules',
    title: '账号规则',
    lead: '账号用于隔离项目、素材与作品记录，请按真实身份使用。',
    sections: [
      {
        heading: '第一条 注册与登录',
        paragraphs: [
          '平台支持邮箱密码、短信验证码与扫码登录，登录令牌到期后需重新登录。',
          '首次登录会自动创建默认项目，后续任务与素材均归属于当前账号。',
        ],
      },
      {
        heading: '第二条 账号安全',
        paragraphs: [
          '请妥善保管密码与验证码，不要向他人透露；修改密码后，该账号此前签发的登录凭证立即失效。',
        ],
      },
      {
        heading: '第三条 违规处理',
        paragraphs: [
          '对滥用接口、批量上传违规素材或攻击服务的行为，运营方可停止其访问。',
        ],
      },
    ],
  },
};

/*
 * 页签清单。以**接口支持的 slug**为准，本地 DOCS 只是兜底正文的一部分。
 *
 * 此前页签直接由 DOCS 派生，而 DOCS 只有三份本地模板文本，
 * minors-policy 这份后台已发布、接口可取的文档因此既不在页签里，
 * 又因「先查本地白名单再生效」被判成 404。
 */
const DOC_TITLES: Record<string, string> = {
  'user-agreement': '用户协议',
  'privacy-policy': '个人信息保护政策',
  'account-rules': '账号规则',
  'minors-policy': '未成年人保护',
};

/** 从路径解析 slug: /legal/privacy-policy.html → privacy-policy */
function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/legal\/([a-z-]+)/);
  return m ? m[1] : null;
}

/* ── 远端文本渲染 ──────────────────────────────────────────────────────────
 * 后台正文是**轻量 Markdown**（`## 标题` / `> 提示` / 空行分段 / 行内 `**粗体**`），
 * 不引 Markdown 库：多一个解析器就多一份 XSS 面，而这里只需要四种块级形态。
 * 未识别的行一律按段落渲染 —— 宁可样式朴素，也不能把文本吞掉。
 */
type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'paragraph'; text: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('## ')) blocks.push({ kind: 'heading', text: line.slice(3).trim() });
    else if (line.startsWith('#')) blocks.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') });
    else if (line.startsWith('> ')) blocks.push({ kind: 'note', text: line.slice(2).trim() });
    else blocks.push({ kind: 'paragraph', text: line });
  }
  return blocks;
}

/** 行内 `**粗体**`；其余按纯文本，绝不 dangerouslySetInnerHTML */
function renderInline(text: string) {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>,
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function LegalPage() {
  const { pathname } = useLocation();
  const slug = slugFromPath(pathname);
  const fallback = slug ? DOCS[slug] : undefined;

  /*
   * 远端文档优先，内置文本兜底。
   *   undefined = 加载中 / null = 后台从未发布过该文档 / 有值 = 用远端
   * 三种状态必须分开：把「加载中」也当「没有」会让页面闪一下旧文本再跳新文本，
   * 而用户读的是法律条文，闪一下比慢一点更糟。
   */
  const [remote, setRemote] = useState<RemoteLegalDoc | null | undefined>(undefined);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setRemote(undefined);
    legalApi
      .current(slug)
      .then((doc) => {
        if (alive) setRemote(doc ?? null);
      })
      .catch(() => {
        // 后端不可达 / 未发布 → 走内置文本，页面不能白屏
        if (alive) setRemote(null);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  /*
   * ⚠ 2026-10-20 行为变更: 此前是 `DOCS[slug] ?? DOCS['user-agreement']` ——
   * 访问 /legal/typo.html 会静默显示**用户协议**。用户点的是别的文档,
   * 却读到一份没点过的法律文本, 这是误导而非兜底。现改为显式 404 并列出真实可选文档。
   */
  /*
   * ⚠ 2026-10-22 修正: 404 判定**必须等远端返回**。
   * 之前 `if (!fallback)` 在发请求之前就返回，等于「本地没有模板文本 = 文档不存在」，
   * 于是后台已发布、`GET /legal/minors-policy` 能正常取到正文的文档，
   * 前台永远 404 —— 而未成年人保护政策属于对外必须可查的合规文本。
   * 现在: 远端有正文 → 渲染; 远端明确没有且本地也无兜底 → 才 404。
   */
  if (remote === undefined && !fallback) {
    return (
      <div className="legal-page">
        <StateLoading tip="正在读取文档…" full />
      </div>
    );
  }

  if (remote === null && !fallback) {
    return (
      <ExceptionPage
        kind="not-found"
        fullScreen
        title="文档不存在"
        desc={`没有找到这份协议文本。${slug ? `当前路径为 ${pathname}。` : ''}可能是地址输入有误，或该文档已调整。`}
        detail={slug ? `requested legal slug: ${slug}` : `无法从路径解析 slug: ${pathname}`}
        action={{ to: '/sitemap.html', label: '查看网站地图' }}
        secondaryAction={
          <div className="legal-missing-list">
            {Object.entries(DOC_TITLES).map(([docSlug, docTitle]) => (
              <Link key={docSlug} to={`/legal/${docSlug}.html`}>
                {docTitle}
              </Link>
            ))}
          </div>
        }
      />
    );
  }

  const blocks = remote ? parseBlocks(remote.content) : [];
  const title = remote?.title ?? fallback?.title ?? '文档';

  return (
    <div className="legal-page">
      <div className="legal-topbar">
        <Link to="/sitemap.html" className="legal-topbar-link">
          ← 网站地图
        </Link>
        <div className="legal-topbar-tabs">
          {Object.entries(DOC_TITLES).map(([docSlug, docTitle]) => (
            <Link
              key={docSlug}
              to={`/legal/${docSlug}.html`}
              className={`legal-tab${docSlug === slug ? ' is-active' : ''}`}
            >
              {docTitle}
            </Link>
          ))}
        </div>
      </div>

      <article className="legal-doc">
        <h1>{title}</h1>

        {remote ? (
          <>
            {blocks.map((b, i) =>
              b.kind === 'heading' ? (
                <h2 key={i}>{renderInline(b.text)}</h2>
              ) : b.kind === 'note' ? (
                <p key={i} className="legal-template-note">
                  {renderInline(b.text)}
                </p>
              ) : (
                <p key={i}>{renderInline(b.text)}</p>
              ),
            )}
            <p className="legal-updated">
              版本 {remote.version}
              {remote.publishedAt ? ` · 生效于 ${formatDate(remote.publishedAt)}` : ''}
            </p>
          </>
        ) : fallback ? (
          <>
            <p className="legal-lead">{fallback.lead}</p>
            <p className="legal-template-note">
              说明：本页为模板文本，尚未经法务审阅；正式对外前请由法务出具正式文本，
              在后台「法务文档」发布后本页即改用已发布版本。
            </p>
            {fallback.sections.map((s) => (
              <section key={s.heading}>
                <h2>{s.heading}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p.slice(0, 12)}>{p}</p>
                ))}
              </section>
            ))}
            <p className="legal-updated">最近更新：2026-10-17</p>
          </>
        ) : null}
      </article>
    </div>
  );
}
