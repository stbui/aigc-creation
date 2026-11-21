import { ShieldCheck } from 'lucide-react';
import { Notice, Skeleton } from './components';

/**
 * 凭据说明是**固定文案**（与数据无关），所以骨架态也照常渲染：它占着
 * 页头与卡片之间的位置，数据到位时卡片不会往上跳一截。只有末行的
 * `credentialSource` 来自接口 —— 加载期间用一根灰条占位，高度对得上。
 *
 * 2026-11 起凭据改为页面可编辑、加密落库：明文密钥不回传、只在保存时出现
 * 一次，库内以 AES-256-GCM 密文存储。界面只显示脱敏值与「是否已配置」。
 */
export function StorageCredentialNotice({
  loading,
  credentialSource,
}: {
  loading: boolean;
  credentialSource?: string;
}) {
  return (
    <Notice tone="info" title="凭据加密存储，页面即可配置。" icon={<ShieldCheck className="size-4 shrink-0" aria-hidden />}>
      <p>在下方卡片点「编辑配置」即可填写 / 修改连接信息，配置仅以密文保存到数据库，页面仅显示脱敏值，留空表示沿用原密钥。</p>
      <p className="mt-1">连接参数支持路径前缀、CDN 公开域名、签名有效期与 STS 临时凭证；建议先在抽屉里「测试连接」，确认读写正常再保存。</p>
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
