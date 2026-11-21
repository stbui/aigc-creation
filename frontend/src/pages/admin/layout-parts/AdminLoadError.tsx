import { ActionButton } from '~/admin-ui/radar';

/** 后台身份接口失败（非权限原因）时的显式失败态 —— 提供重试，不误导成权限问题 */
export function AdminLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-root flex min-h-screen items-center justify-center bg-page p-6">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-card p-8 shadow-card">
        <h1 className="mb-2 text-xl font-semibold text-foreground">后台暂时连不上</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          没能取到后台身份信息。这通常是网络中断或服务暂时不可用，与账号权限无关。
        </p>
        <div className="mb-6 rounded-lg bg-muted px-3.5 py-3 text-[13px] text-muted-foreground">
          <strong className="mb-1.5 block text-[13px] text-foreground">错误信息</strong>
          <ul className="m-0 list-disc pl-[18px]">
            <li className="my-0.5">{message}</li>
          </ul>
        </div>
        <ActionButton variant="default" onClick={onRetry}>
          重新连接
        </ActionButton>
      </div>
    </div>
  );
}
