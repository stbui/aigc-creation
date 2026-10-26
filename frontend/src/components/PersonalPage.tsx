import type { ReactNode } from 'react';
import { Button, Typography } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

/**
 * 个人域页面统一骨架（账户 / 积分 / 订单 / 工单 / 邀请 / 数据中心）。
 *
 * 此前各页各自写标题、返回按钮与最大宽度（760 / 900 / 1000 / 1200），
 * 同一个「返回」在不同页面的位置和字号也不一致。这里只收敛页面级结构，
 * 内容区各页仍保留自己的业务组件。
 */
export function PersonalPage({
  title,
  description,
  extra,
  children,
  className = '',
  width = 'wide',
  showBack = true,
}: {
  title?: string;
  description?: ReactNode;
  /** 标题右侧的主操作 */
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  /** wide = 个人中心列表页；narrow = 账户设置类长表单 */
  width?: 'wide' | 'narrow';
  showBack?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className={`personal-page is-${width}${className ? ` ${className}` : ''}`}>
      {showBack && (
        <Button
          type="text"
          size="small"
          className="personal-page-back"
          icon={<ArrowLeft size={15} />}
          onClick={() => navigate(-1)}
        >
          返回
        </Button>
      )}
      {(title || description || extra) && (
        <header className="personal-page-head">
          <div className="personal-page-heading">
            {title && <Title level={3}>{title}</Title>}
            {description && <Text type="secondary">{description}</Text>}
          </div>
          {extra && <div className="personal-page-extra">{extra}</div>}
        </header>
      )}
      <div className="personal-page-body">{children}</div>
    </div>
  );
}
