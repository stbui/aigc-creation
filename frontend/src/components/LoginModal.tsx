import { Modal } from 'antd';
import { AuthCard } from './AuthCard';
import { useAuth } from '../context/AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 身份版本号: 登录成功后 AuthProvider 会递增它, 弹窗据此重置内部表单态
   * (避免关掉再打开时残留上一次的注册模式与已填内容)。
   */
  authEpoch: number;
}

/**
 * 登录弹窗 —— 复刻参考站「顶栏登录/注册按钮 → 遮罩弹窗」的唤起方式。
 *
 * 参考站的遮罩是 `.auth-overlay`(暗色半透明 + 居中), 本地用 antd Modal 承载,
 * 但**内容区尺寸与 AuthCard 完全一致** (840×478), 视觉与 `/login` 独立页同源同实现。
 */
export function LoginModal({ open, onClose, authEpoch }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      maskClosable
      keyboard
      width={840}
      centered
      destroyOnHidden
      className="login-modal"
      styles={{
        // antd 6 把 v5 的 `content` 语义键改名为 `container` (见 ModalSemanticType)
        container: { padding: 0, background: 'transparent', boxShadow: 'none' },
        mask: { background: 'rgba(24, 32, 51, 0.55)' },
      }}
    >
      {/* key 绑定身份版本: 每次登录成功都重建卡片, 清空内部表单态 */}
      <AuthCard key={authEpoch} onSuccess={onClose} />
    </Modal>
  );
}

/**
 * 弹窗宿主 —— 必须渲染在 `<BrowserRouter>` 之内 (见 App.tsx)。
 *
 * AuthCard 内部用 `useNavigate()` 跳「忘记密码」; 若宿主放在 AuthProvider 里
 * (Router 之外) 会抛 "useNavigate() may be used only in the context of a
 * <Router> component", 弹窗压根挂不上 —— 用户看到的是「点按钮没反应」。
 */
export function LoginModalHost() {
  const { loginOpen, closeLogin, authEpoch } = useAuth();
  return <LoginModal open={loginOpen} onClose={closeLogin} authEpoch={authEpoch} />;
}