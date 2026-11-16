import { Lock } from 'lucide-react';
import { Notice, Skeleton } from './components';

/**
 * 凭据提示是**固定文案**（与数据无关），所以骨架态也照常渲染：它占着
 * 页头与卡片之间的位置，数据到位时卡片不会往上跳一截。只有末行的
 * `credentialSource` 来自接口 —— 加载期间用一根灰条占位，高度对得上。
 *
 * 凭据只读：PRD §3.11 明确约束「凭据走部署期环境变量，界面不可编辑」，
 * 本页没有任何写凭据的输入框 —— 展示脱敏值 + 连通性 + 切换默认后端。
 * 这不是功能缺失，是刻意的安全边界。
 */
export function StorageCredentialNotice({
  loading,
  credentialSource,
}: {
  loading: boolean;
  credentialSource?: string;
}) {
  return (
    <Notice tone="locked" title="凭据不在界面配置。" icon={<Lock className="size-4 shrink-0" aria-hidden />}>
      <p>出于安全考虑，OSS / MinIO 的密钥只从部署环境变量读取，页面仅显示是否配置与脱敏值。</p>
      {loading ? (
        <Skeleton className="mt-1 h-3 w-72" />
      ) : (
        <code className="mt-1 block font-mono text-[12px] break-all text-muted-foreground">
          {credentialSource}
        </code>
      )}
    </Notice>
  );
}
