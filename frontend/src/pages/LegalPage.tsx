import { Link, useLocation } from 'react-router-dom';
import { ExceptionPage } from '../components/ExceptionPage';

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
 * 逐字照搬会构成本项目由该公司运营的法律声明，故**只复刻版式**、正文使用本项目模板文本
 * 并在首段明示为演示模板。正式对外前需由法务出具正式文本。
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
    lead: '本协议是货觉AI（本地演示项目）与使用者之间的使用约定模板。',
    sections: [
      {
        heading: '第一条 协议主体与效力',
        paragraphs: [
          '本项目为技术演示性质，运营主体信息以实际部署方登记为准。使用者指自愿注册、登录并使用本平台服务的个人或企业。',
          '使用者勾选同意并开始使用，视为已阅读并接受本协议全部条款。',
        ],
      },
      {
        heading: '第二条 服务内容',
        paragraphs: [
          '本平台提供电商图片生成与处理能力，包括商品主图、商品详情图、爆款复刻、局部重绘、一键抠图、去水印、产品精修、图片翻译、智能扩图、商品换色、旋转角度等工具。',
          '当前版本以本地算法渲染产出图片，其中部分能力为参数化占位实现，页面已如实标注。',
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
    lead: '本政策说明货觉AI（本地演示项目）如何处理使用者提供的信息。',
    sections: [
      {
        heading: '第一条 我们收集的信息',
        paragraphs: [
          '账号信息：邮箱地址、登录令牌。演示环境使用本地数据库与文件系统存储。',
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
          '素材与生成图保存在服务器本地磁盘，通过 /uploads 静态路径访问。',
          '使用者可在「我的作品」与「素材库」中删除任务与素材，删除会同步清理磁盘文件。',
        ],
      },
      {
        heading: '第四条 共享与披露',
        paragraphs: [
          '当前版本不会将个人信息共享给第三方。若后续接入第三方模型或云服务，将在接入前更新本政策并说明数据流向。',
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
          '演示环境提供注册与登录功能，令牌有效期默认 7 天，过期后需重新登录。',
          '首次登录会自动创建默认项目，后续任务与素材均归属于当前账号。',
        ],
      },
      {
        heading: '第二条 账号安全',
        paragraphs: [
          '请妥善保管登录凭证；演示环境未实现多因素认证，不建议在公网环境长期使用。',
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

/** 从路径解析 slug: /legal/privacy-policy.html → privacy-policy */
function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/legal\/([a-z-]+)/);
  return m ? m[1] : null;
}

export function LegalPage() {
  const { pathname } = useLocation();
  const slug = slugFromPath(pathname);
  const doc = slug ? DOCS[slug] : undefined;

  /*
   * ⚠ 2026-10-20 行为变更: 此前是 `DOCS[slug] ?? DOCS['user-agreement']` ——
   * 访问 /legal/typo.html 会静默显示**用户协议**。用户点的是别的文档,
   * 却读到一份没点过的法律文本, 这是误导而非兜底。现改为显式 404 并列出真实可选文档。
   */
  if (!doc) {
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
            {Object.values(DOCS).map((d) => (
              <Link key={d.slug} to={`/legal/${d.slug}.html`}>
                {d.title}
              </Link>
            ))}
          </div>
        }
      />
    );
  }

  return (
    <div className="legal-page">
      <div className="legal-topbar">
        <Link to="/sitemap.html" className="legal-topbar-link">
          ← 网站地图
        </Link>
        <div className="legal-topbar-tabs">
          {Object.values(DOCS).map((d) => (
            <Link
              key={d.slug}
              to={`/legal/${d.slug}.html`}
              className={`legal-tab${d.slug === doc.slug ? ' is-active' : ''}`}
            >
              {d.title}
            </Link>
          ))}
        </div>
      </div>

      <article className="legal-doc">
        <h1>{doc.title}</h1>
        <p className="legal-lead">{doc.lead}</p>
        <p className="legal-template-note">
          说明：本页为演示模板文本，用于对齐参考站 /legal/*.html 的文档版式；
          参考站原文以第三方公司为主体，直接照搬会构成错误主体声明，正式对外前请替换为法务文本。
        </p>
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 12)}>{p}</p>
            ))}
          </section>
        ))}
        <p className="legal-updated">最近更新：2026-10-17</p>
      </article>
    </div>
  );
}
