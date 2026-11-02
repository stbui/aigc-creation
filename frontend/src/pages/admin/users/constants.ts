/**
 * 用户管理的角色、状态与登录原因映射。
 *
 * 角色 / 状态取值必须与后端白名单一致；登录原因是展示口径，未知值由界面
 * 原样显示，避免后端新增原因被静默吞成「其他」。
 */

export const ROLE_OPTIONS = [
  { value: 'user', label: '用户' },
  { value: 'admin', label: '管理员' },
  { value: 'operator', label: '运营' },
  { value: 'finance', label: '财务' },
];

export const STATUS_OPTIONS = [
  { value: 'active', label: '正常' },
  { value: 'disabled', label: '已禁用' },
  { value: 'deleted', label: '已注销' },
];

/** 列表默认排序。后端默认与之一致，显式传参是为了让表头箭头与请求口径对得上。 */
export const DEFAULT_SORT = 'createdAt:desc';

/** 登录方式 / 失败原因 → 中文 */
export const LOGIN_REASON_LABEL: Record<string, string> = {
  password: '密码登录',
  sms: '短信登录',
  bad_credentials: '邮箱或密码错误',
  sms_code: '短信验证码错误',
  disabled: '账号已禁用',
  deleted: '账号已注销',
};

/** 物理删除的二次确认词。后端按字面校验，前后端必须一致。 */
export const DELETE_CONFIRM_WORD = '删除';
