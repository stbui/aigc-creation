import { Button, PersonalPage, StateEmpty } from './components';

interface InviteGuestStateProps {
  onLogin: () => void;
}

/** 访客态：只渲染登录引导，不请求需要鉴权的邀请接口。 */
export function InviteGuestState({ onLogin }: InviteGuestStateProps) {
  return (
    <PersonalPage title="邀请有奖" description="邀请好友注册，双方都能获得积分；每天签到也能领积分。">
      <StateEmpty
        title="登录后查看邀请与签到"
        desc="邀请链接、邀请人数与每日签到都与账号绑定；带邀请码进入的新用户注册后会自动绑定。"
        action={
          <Button type="primary" onClick={onLogin}>
            登录/注册
          </Button>
        }
      />
    </PersonalPage>
  );
}
