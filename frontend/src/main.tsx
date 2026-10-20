import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles/global.css';
import App from './App';

/**
 * antd 主题 token —— 2026-10-19 精调: 原值为 Tailwind slate/blue 通用色板
 * (colorPrimary #2563EB 等), 与全站品牌紫系冲突, 导致 antd 默认面持续漏蓝
 * (登录主按钮 / Spin / Input focus ring 等)。现按参考站 ijihua.cn 色板归位:
 *   --primary 组件紫 #5546d8 (参考站 CTA/active 字面值; hover 加深 #4838c6 同参考站)
 *   --text #182033 / 次级 #667085 / --line #e6e8ef / --bg #f6f7fb
 *   --success #18a875 / --danger #ef4444 (参考站 :root token 实测)
 * borderRadius 8 / fontSize 14 维持 antd 控件基准 (参考站控件半径 6-12, 8 为折中;
 * 基准字号改 16 会连锁改变全部 antd 控件高度, 不做)。证据: docs/typography-components-details.md
 *
 * fontFamily 必须在这里声明, 不能只靠 global.css 的 body 规则:
 * antd v6 的 <App> 会渲染一个带 css-dev-only-do-not-override-* class 的 wrapper,
 * 该 wrapper 上有 antd 自己的 font-family (系统栈 -apple-system/system-ui/…),
 * 它不继承 body 的字体栈 —— 于是全站 UI (body 之外的一切) 实际都渲染成 PingFang SC,
 * body 上那行 Noto Sans SC 优先的声明等于死代码。
 * CDP `CSS.getPlatformFontsForNode` 实测: 参考站 ijihua.cn hero h1 实际渲染
 * 「Noto Sans SC」(Google webfont), 本地同一节点渲染「PingFang SC + .SF NS」;
 * token 补fontFamily 后两端对齐。证据: docs/typography-components-details.md §附录 D
 */
const ANTD_THEME_TOKEN = {
  colorPrimary: '#5546d8',
  colorPrimaryHover: '#4838c6',
  colorError: '#ef4444',
  colorSuccess: '#18a875',
  colorBgLayout: '#f6f7fb',
  colorBorder: '#e6e8ef',
  colorText: '#182033',
  colorTextSecondary: '#667085',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: "'Noto Sans SC', Inter, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: ANTD_THEME_TOKEN }}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
