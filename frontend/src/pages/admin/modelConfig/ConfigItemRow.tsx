import { Col, Flex, Input, InputNumber, Row, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import type { AdminModelConfigItem } from '../../../types/api';
import { SOURCE_META, fmtTime, tagColor, withoutModalityPrefix } from './meta';

/**
 * 单个配置项（antd Row/Col 布局）。
 *
 * 来源信息只在需要时出现：默认值不挂标签，env 名放进 label tooltip；
 * 只有真被 env 覆盖时，才在正文里显示变量名与后台曾保存的值。
 */
export function ConfigItemRow({
  item,
  value,
  cleared,
  canWrite,
  onChange,
  onToggleClear,
}: {
  item: AdminModelConfigItem;
  value: string | number | boolean | undefined;
  cleared: boolean;
  canWrite: boolean;
  onChange: (value: string | number | boolean) => void;
  onToggleClear: () => void;
}) {
  const meta = SOURCE_META[item.source] ?? SOURCE_META.default;
  const locked = item.source === 'env';
  const label = item.modality ? withoutModalityPrefix(item.label, item.modality) : item.label;

  const control = cleared ? (
    <Typography.Text type="warning">保存后恢复为默认值「{String(item.default)}」</Typography.Text>
  ) : item.type === 'boolean' ? (
    <Switch checked={Boolean(value)} disabled={locked || !canWrite} onChange={(v) => onChange(v)} />
  ) : item.type === 'number' ? (
    <InputNumber
      style={{ width: '100%' }}
      value={Number(value ?? 0)}
      disabled={locked || !canWrite}
      onChange={(v) => onChange(Number(v ?? 0))}
    />
  ) : item.type === 'secret' ? (
    <Flex gap={8} align="center">
      <Input.Password
        style={{ flex: 1 }}
        value={String(value ?? '')}
        placeholder={item.hasValue ? `已配置（${item.masked ?? '***'}），留空保持不变` : '尚未配置'}
        disabled={!canWrite || locked}
        autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)}
      />
      <Tooltip title={locked ? '该项被部署环境变量覆盖，后台无法修改' : meta.hint}>
        <Tag color={item.hasValue ? 'success' : 'default'} variant="filled">
          {locked ? '环境变量' : item.hasValue ? '已配置' : '未配置'}
        </Tag>
      </Tooltip>
    </Flex>
  ) : (
    <Input
      value={String(value ?? '')}
      disabled={locked || !canWrite}
      placeholder={
        item.key.endsWith('.baseUrl')
          ? 'https://api.example.com'
          : item.key.endsWith('.model')
            ? '留空则使用协议默认模型'
            : String(item.default)
      }
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <Row
      gutter={24}
      align="middle"
      style={{ padding: '12px 0', borderBottom: '1px solid var(--border-row)' }}
    >
      <Col xs={24} md={14}>
        <Space size={8} wrap>
          <Tooltip title={item.envName ? `可用环境变量 ${item.envName} 覆盖` : undefined}>
            <Typography.Text strong>{label}</Typography.Text>
          </Tooltip>
          {item.source !== 'default' && (
            <Tooltip title={meta.hint}>
              <Tag color={tagColor(meta.tone)} variant="filled">
                {meta.label}
              </Tag>
            </Tooltip>
          )}
          {item.overridden && !locked && (
            <ButtonLink
              disabled={!canWrite}
              text={cleared ? '取消恢复' : '恢复默认'}
              onClick={onToggleClear}
            />
          )}
        </Space>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '2px 0 0' }}>
          {item.description}
        </Typography.Paragraph>

        {locked && (item.dbValue != null || item.dbHasValue) && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            后台曾保存：<Typography.Text code>{item.secret ? item.dbMasked : String(item.dbValue)}</Typography.Text>
            （当前被环境变量覆盖，保存不会生效）
          </Typography.Text>
        )}
        {locked && item.dbValue == null && !item.dbHasValue && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            后台没有保存过该项，当前完全由部署环境提供。
          </Typography.Text>
        )}

        {item.overridden && item.updatedAt && (
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
            上次修改：{item.updatedBy || 'admin'} · {fmtTime(item.updatedAt)}
          </Typography.Text>
        )}
      </Col>
      <Col xs={24} md={10}>
        {control}
      </Col>
    </Row>
  );
}

/** 极轻量的行内操作按钮，避免每行都渲染一个完整 Button */
function ButtonLink({
  text,
  disabled,
  onClick,
}: {
  text: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Typography.Link
      style={{ fontSize: 12 }}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {text}
    </Typography.Link>
  );
}
