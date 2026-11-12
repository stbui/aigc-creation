import { useNavigate } from 'react-router-dom';

/**
 * 业务类型切换 tab（商品主图 / 商品详情 / 爆款复刻）。
 *
 * 命名带 Tool：这是跨页导航；右栏「功能示例 / 创作结果」是同一页内的面板页签，
 * 两者不应都叫 Tabs。
 * 参考站只在窄屏显示这组 tab（桌面端 `display: none` 实拍确认），
 * 所以这里保持相同的 DOM 顺序与类名，显隐交给 `pk-editor-tabs` 的样式。
 */
export function ProductKitToolTabs() {
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
