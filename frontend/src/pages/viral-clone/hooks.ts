/**
 * 爆款复刻工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页的独有 hook (`useCollectedReferenceAsset`) 也放在这里; 以后出现
 * 「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/hooks` / `src/context` / `src/components`
 * 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { assetsApi, assetSrc } from './api';
import type { PkAsset } from './constants';
import { useApp } from '../../ui';

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 粘贴上传 (商品图 / 参考图按当前聚焦的上传区回填) */
export { usePasteUpload } from '../../hooks/usePasteUpload';
/** 能力运行时状态: 后台下线或无线路时在前端事前标注 */
export { useCapabilities } from '../../hooks/useCapabilities';
/** 实时积分单价 (后台可调价) */
export { useCreditLabel } from '../../hooks/useCreditLabel';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export { useResultGallery, type GalleryItem, type ResultGallery } from '../../hooks/useResultGallery';
/** 素材库取数 */
export { useAssetLibrary } from '../../hooks';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

/**
 * 浏览器扩展「图片复刻」带参考图进入本页。
 *
 * 扩展只拿得到素材 id (生成接口吃 inputAssetIds, 不是 URL), 故约定
 * `/viral-clone?referenceAssetId=xxx`: 进来按 id 取回素材回填参考图,
 * 用完即从地址栏摘掉 —— 保留会让刷新/后退重复拉取, 也会让用户复制链接
 * 给别人时莫名其妙多带一张图。
 *
 * 未登录时不发请求 (C 端路由开放浏览, 此时必然 401); 参数留在地址上,
 * 登录回来 token 到位后本 hook 自然再次触发。
 */
export function useCollectedReferenceAsset(onLoaded: (asset: PkAsset) => void) {
  const { message } = useApp();
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const referenceAssetId = searchParams.get('referenceAssetId');
  /** 已处理过的 id, 防止 token 变化等依赖抖动导致重复拉取 */
  const handledReferenceAssetId = useRef<string | null>(null);

  useEffect(() => {
    if (!referenceAssetId || !token) return;
    if (handledReferenceAssetId.current === referenceAssetId) return;
    handledReferenceAssetId.current = referenceAssetId;

    let cancelled = false;
    void (async () => {
      try {
        const asset = await assetsApi.get(referenceAssetId);
        if (cancelled) return;
        onLoaded({
          id: asset.id,
          url: assetSrc(asset) ?? '',
          name: asset.sourceTitle || asset.sourceUrl.split('/').pop() || '参考图',
        });
        message.success('已带入采集的参考图');
      } catch (e) {
        if (cancelled) return;
        message.error((e as Error).message || '参考图读取失败');
      } finally {
        if (!cancelled) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete('referenceAssetId');
              return next;
            },
            { replace: true },
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [referenceAssetId, token, message, setSearchParams, onLoaded]);
}
