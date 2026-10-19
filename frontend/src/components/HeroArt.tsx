/**
 * 工作台 hero 右侧视觉。
 *
 * 有真实产出时: 用最近生成的真实结果图拼成"作品集"卡片组 (与参考站 hero 右侧的
 * 图片集构图一致 —— 主图 + 两张偏移小卡 + 装饰元素), 全部是本地管线真实输出, 不冒充实拍素材。
 * 无产出时: 退回到原创 SVG 流程示意图 (商品图 → 工作流 → 多端输出)。
 */
export function HeroArt({
  className,
  thumbs = [],
}: {
  className?: string;
  /** 真实产出缩略图 (最多取 3 张), 为空则渲染 SVG 示意 */
  thumbs?: Array<string | null | undefined>;
}) {
  const imgs = thumbs.filter((t): t is string => Boolean(t)).slice(0, 3);

  if (imgs.length === 0) {
    return <HeroSvg className={className} />;
  }

  return (
    <div className="wb-hero-collage" aria-hidden="true">
      <span className="wb-hero-dot wb-hero-dot-a" />
      <span className="wb-hero-dot wb-hero-dot-b" />
      <span className="wb-hero-dot wb-hero-dot-c" />
      {imgs[1] && (
        <span className="wb-hero-photo wb-hero-photo-side wb-hero-photo-back">
          <img src={imgs[1]} alt="" loading="lazy" />
        </span>
      )}
      {imgs[2] && (
        <span className="wb-hero-photo wb-hero-photo-side wb-hero-photo-front">
          <img src={imgs[2]} alt="" loading="lazy" />
        </span>
      )}
      <span className="wb-hero-photo wb-hero-photo-main">
        <img src={imgs[0]} alt="" loading="lazy" />
      </span>
      {/* 数据小卡: 呼应参考站 hero 右侧的 UI 卡片元素 */}
      <span className="wb-hero-chip">
        <span className="wb-hero-chip-bar">
          <i style={{ height: '40%' }} />
          <i style={{ height: '70%' }} />
          <i style={{ height: '55%' }} />
          <i style={{ height: '90%' }} />
        </span>
        <span className="wb-hero-chip-num">12 项能力</span>
      </span>
    </div>
  );
}

/** 无真实产出时的原创 SVG 示意图 (装饰性几何, 无外部资源) */
function HeroSvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 240"
      role="img"
      aria-label="电商视觉工作流示意图"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="heroGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#DBEAFE" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="heroCard" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#EFF6FF" />
          <stop offset="100%" stopColor="#DBEAFE" />
        </linearGradient>
        <linearGradient id="heroBrand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>

      <circle cx="212" cy="120" r="104" fill="url(#heroGlow)" />

      <g stroke="#93C5FD" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="5 6">
        <path d="M108 120 C 136 120, 140 96, 168 96" />
        <path d="M108 120 C 136 120, 140 148, 168 148" />
        <path d="M262 120 C 292 120, 296 92, 322 92" />
        <path d="M262 120 C 292 120, 296 150, 322 150" />
      </g>

      <g>
        <rect x="72" y="86" width="46" height="68" rx="8" fill="#FFFFFF" stroke="#BFDBFE" />
        <rect x="80" y="98" width="30" height="26" rx="4" fill="#DBEAFE" />
        <rect x="80" y="130" width="22" height="4" rx="2" fill="#BFDBFE" />
        <rect x="80" y="139" width="14" height="4" rx="2" fill="#E0EDFF" />
      </g>

      <g>
        <rect x="164" y="64" width="102" height="112" rx="12" fill="url(#heroCard)" stroke="#BFDBFE" />
        <rect x="176" y="78" width="78" height="56" rx="8" fill="#FFFFFF" />
        <rect x="204" y="88" width="22" height="36" rx="5" fill="url(#heroBrand)" />
        <rect x="209" y="82" width="12" height="8" rx="3" fill="#1E3A8A" />
        <rect x="176" y="142" width="46" height="6" rx="3" fill="#93C5FD" />
        <rect x="176" y="154" width="30" height="5" rx="2.5" fill="#BFDBFE" />
        <rect x="240" y="142" width="14" height="14" rx="7" fill="#FFFFFF" stroke="#93C5FD" />
        <path d="M245 149 l3 3 l5 -6" stroke="#2563EB" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <g>
        <rect x="318" y="64" width="62" height="46" rx="10" fill="#FFFFFF" stroke="#BFDBFE" />
        <rect x="328" y="74" width="42" height="16" rx="4" fill="#DBEAFE" />
        <rect x="328" y="94" width="26" height="6" rx="3" fill="#E0EDFF" />
      </g>

      <g>
        <rect x="318" y="126" width="62" height="50" rx="10" fill="#FFFFFF" stroke="#BFDBFE" />
        <rect x="330" y="152" width="7" height="14" rx="2" fill="#BFDBFE" />
        <rect x="341" y="144" width="7" height="22" rx="2" fill="#93C5FD" />
        <rect x="352" y="136" width="7" height="30" rx="2" fill="#3B82F6" />
        <rect x="363" y="148" width="7" height="18" rx="2" fill="#93C5FD" />
      </g>

      <g fill="#93C5FD" opacity="0.75">
        <circle cx="300" cy="52" r="3" />
        <circle cx="120" cy="186" r="2.5" />
        <circle cx="288" cy="200" r="2" />
        <circle cx="62" cy="60" r="2" />
      </g>
    </svg>
  );
}
