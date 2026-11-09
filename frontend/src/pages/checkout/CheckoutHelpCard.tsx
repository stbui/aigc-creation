import { HelpCircle } from 'lucide-react';

import { safeHelpImageUrl } from './utils';

/** 充值页帮助信息：文字与客服二维码均为空时整卡不渲染。 */
export function CheckoutHelpCard({
  helpImage,
  helpText,
}: {
  helpImage: string;
  helpText: string;
}) {
  const imageUrl = safeHelpImageUrl(helpImage);
  const text = helpText.trim();
  if (!imageUrl && !text) return null;

  return (
    <section className="co-card">
      <div className="co-card-head">
        <h2>帮助信息</h2>
        <HelpCircle size={16} aria-hidden />
      </div>
      <div className="co-help">
        {text && <p className="co-help-text">{text}</p>}
        {imageUrl && (
          <img
            className="co-help-image"
            src={imageUrl}
            alt="客服帮助图片"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </section>
  );
}
