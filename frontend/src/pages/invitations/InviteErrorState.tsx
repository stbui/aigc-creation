import { PersonalPage, StateError } from './components';

interface InviteErrorStateProps {
  error: string | null;
  onRetry: () => void;
}

/** 加载失败：如实说明，不编造任何数字，并给出重试入口。 */
export function InviteErrorState({ error, onRetry }: InviteErrorStateProps) {
  return (
    <PersonalPage title="邀请有奖" description="邀请好友注册，双方都能获得积分；每天签到也能领积分。">
      <StateError
        title="邀请数据加载失败"
        desc="请确认已登录，且后端服务正常运行。本页数据全部来自真实接口，加载失败时不展示任何占位数字。"
        detail={error ?? undefined}
        onRetry={onRetry}
      />
    </PersonalPage>
  );
}
