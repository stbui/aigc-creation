/**
 * 左栏礼盒插画 —— 原创内联 SVG (参考站 .auth-showcase-gift 实测 221x214)。
 *
 * 2026-11-15 从 `AuthCard` 抽出：纯展示，无 props、无状态。
 * 不引参考站位图资源, 同 ToolEmptyIllustration 的纪律。
 * 参考站原图是紫色礼盒 + 金币 + 宝石的插画, 这里用同构的矢量版本重绘。
 */
export function LoginGiftArt() {
  return (
    <svg
      className="login-showcase-gift"
      width="221"
      height="214"
      viewBox="0 0 221 214"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="lg-box" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6d5bd8" />
        </linearGradient>
        <linearGradient id="lg-lid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9a2fb" />
          <stop offset="1" stopColor="#7c6ae0" />
        </linearGradient>
        <linearGradient id="lg-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f5a524" />
        </linearGradient>
      </defs>

      {/* 投影 */}
      <ellipse cx="112" cy="186" rx="66" ry="11" fill="#5546d8" opacity="0.14" />

      {/* 盒身 */}
      <rect x="54" y="92" width="116" height="88" rx="12" fill="url(#lg-box)" />
      {/* 盒盖 */}
      <rect x="42" y="70" width="140" height="30" rx="10" fill="url(#lg-lid)" />
      {/* 竖丝带 */}
      <rect x="100" y="70" width="22" height="110" fill="#ffd666" opacity="0.95" />
      <rect x="100" y="70" width="7" height="110" fill="#ffe9a8" opacity="0.9" />

      {/* 蝴蝶结 */}
      <path d="M111 70 C 96 50, 68 44, 66 58 C 64 70, 90 72, 111 70 Z" fill="#8b7ae8" />
      <path d="M111 70 C 126 50, 154 44, 156 58 C 158 70, 132 72, 111 70 Z" fill="#7a68dd" />
      <circle cx="111" cy="68" r="8" fill="#a78bfa" />

      {/* 金币 */}
      <circle cx="58" cy="128" r="17" fill="url(#lg-coin)" />
      <path
        d="M58 119 v18 M52 124 h12 M52 132 h12"
        stroke="#b45309"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="166" cy="132" r="13" fill="url(#lg-coin)" />
      <path
        d="M166 125 v14 M162 129 h8 M162 135 h8"
        stroke="#b45309"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="74" cy="160" r="9" fill="url(#lg-coin)" />

      {/* 宝石点缀 */}
      <path d="M186 66 l5 11 11 5 -11 5 -5 11 -5 -11 -11 -5 11 -5 Z" fill="#67e8f9" opacity="0.9" />
      <circle cx="30" cy="108" r="4" fill="#ffffff" opacity="0.75" />
      <circle cx="196" cy="104" r="3" fill="#ffffff" opacity="0.6" />
      <circle cx="40" cy="46" r="2.5" fill="#ffffff" opacity="0.55" />
    </svg>
  );
}
