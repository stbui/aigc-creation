import { useNavigate } from 'react-router-dom';

/**
 * 业务类型切换 tab。
 *
 * 参考站只在窄屏显示这组 tab（桌面端 `display: none` 实拍确认），
 * 所以这里保持相同的 DOM 顺序与类名，显隐交给 `pk-editor-tabs` 的样式。
 */
export function ProductKitTabs() {
  const navigate = useNavigate();

  return (
    <div className="pk-editor-tabs" role="tablist" aria-label="业务类型">
      <button type="button" role="tab" aria-selected className="pk-editor-tab pk-editor-tab-active">
        商品主图
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        className="pk-editor-tab"
        onClick={() => navigate('/product-detail')}
      >
        商品详情
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        className="pk-editor-tab"
        onClick={() => navigate('/viral-clone')}
      >
        爆款复刻
      </button>
    </div>
  );
}
