import { Images } from 'lucide-react';

/**
 * 访客态：作品与账号绑定，直接给登录入口。
 *
 * 不能让访客看到「还没有作品」—— 那会让人以为产出丢了。
 */
export interface WorksGuestStateProps {
  onLogin: () => void;
}

export function WorksGuestState({ onLogin }: WorksGuestStateProps) {
  return (
    <div className="my-works-empty">
      <Images size={72} strokeWidth={1.35} aria-hidden="true" />
      <h2>登录后查看你的作品</h2>
      <p>作品与账号绑定，登录后即可查看、下载并继续创作。</p>
      <button type="button" className="my-works-empty-action" onClick={onLogin}>
        登录/注册
      </button>
    </div>
  );
}
