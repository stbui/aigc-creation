import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Save } from 'lucide-react';
import {
  ActionButton,
  Drawer,
  FormField,
  Notice,
  SelectField,
  TextField,
} from '~/admin-ui/primitives';
import { adminAssetsApi, adminUsersApi } from './api';
import type { AdminProject, AdminUserListResult, Project } from '../../../types/api';

type UserRow = AdminUserListResult['items'][number];

interface ProjectFormDrawerProps {
  open: boolean;
  editing: AdminProject | null;
  onClose: () => void;
  onSaved: (project: Project, mode: 'create' | 'update') => void;
}

/**
 * 后台项目新建 / 重命名。
 *
 * 新建时必须选择归属用户；编辑时归属用户只读，避免项目 owner 与素材 owner
 * 脱节。用户列表按关键词查询，默认加载前 100 个正常账号，保证大账号量下仍
 * 能通过邮箱或名称找到目标用户。
 */
export function ProjectFormDrawer({ open, editing, onClose, onSaved }: ProjectFormDrawerProps) {
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [selectedOwnerLabel, setSelectedOwnerLabel] = useState('');
  const [userKeyword, setUserKeyword] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setOwnerId(editing?.ownerId ?? '');
    setSelectedOwnerLabel('');
    setUserKeyword('');
    setUsers([]);
    setUsersError(null);
    setFormError(null);
  }, [editing, open]);

  useEffect(() => {
    if (!open || editing) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setUsersLoading(true);
      setUsersError(null);
      void adminUsersApi
        .list({
          keyword: userKeyword.trim() || undefined,
          status: 'active',
          page: 1,
          pageSize: 100,
        })
        .then((result) => {
          if (alive) setUsers(result.items);
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setUsers([]);
          setUsersError(error instanceof Error ? error.message : '用户列表加载失败');
        })
        .finally(() => {
          if (alive) setUsersLoading(false);
        });
    }, 200);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [editing, open, userKeyword]);

  const ownerOptions = useMemo(() => {
    if (!editing) {
      const options = users.map((user) => ({
        value: user.id,
        label: user.name ? `${user.name} · ${user.email}` : user.email,
      }));
      // 搜索条件变化后仍保留已选用户，避免下拉框因选项消失而显示空白。
      if (ownerId && !options.some((option) => option.value === ownerId)) {
        options.unshift({ value: ownerId, label: selectedOwnerLabel || '已选择用户' });
      }
      return options;
    }
    return [{
      value: editing.ownerId,
      label: editing.ownerName
        ? `${editing.ownerName} · ${editing.ownerEmail}`
        : editing.ownerEmail,
    }];
  }, [editing, ownerId, selectedOwnerLabel, users]);

  const canSave = name.trim().length > 0 && (Boolean(editing) || Boolean(ownerId));

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const project = editing
        ? await adminAssetsApi.updateProject(editing.id, name.trim())
        : await adminAssetsApi.createProject({ name: name.trim(), ownerId });
      onSaved(project, editing ? 'update' : 'create');
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      width={520}
      title={editing ? `编辑项目 · ${editing.name}` : '新建项目'}
      description={editing ? '仅修改项目名称；归属用户不会改变。' : undefined}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            variant="default"
            size="sm"
            icon={editing ? Save : FolderPlus}
            disabled={!canSave || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : editing ? '保存' : '创建项目'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <Notice tone="danger" className="mb-0">
            {formError}
          </Notice>
        )}

        <FormField label="项目名称" required hint="用于素材库中的项目分组，最多 80 个字符。">
          <TextField
            ariaLabel="项目名称"
            value={name}
            maxLength={80}
            showCount
            placeholder="例如：双十一主视觉"
            disabled={saving}
            onChange={setName}
            onEnter={() => void save()}
          />
        </FormField>

        {editing ? (
          <FormField label="所属用户">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              <div>{editing.ownerName || '未命名用户'}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{editing.ownerEmail}</div>
            </div>
          </FormField>
        ) : (
          <>
            <FormField label="搜索用户" hint="按邮箱或名称搜索正常状态账号。">
              <TextField
                ariaLabel="搜索所属用户"
                value={userKeyword}
                placeholder="输入邮箱或名称"
                disabled={saving}
                onChange={setUserKeyword}
              />
            </FormField>

            <FormField
              label="所属用户"
              required
              error={usersError}
              hint={usersLoading ? '正在加载用户…' : '默认展示前 100 个账号，可用上方搜索缩小范围。'}
            >
              <SelectField
                ariaLabel="所属用户"
                value={ownerId || undefined}
                onChange={(value) => {
                  const next = value ?? '';
                  const user = users.find((candidate) => candidate.id === next);
                  setOwnerId(next);
                  setSelectedOwnerLabel(
                    user ? (user.name ? `${user.name} · ${user.email}` : user.email) : '',
                  );
                }}
                options={ownerOptions}
                placeholder={usersLoading ? '正在加载用户…' : '请选择所属用户'}
                disabled={saving || usersLoading}
              />
            </FormField>
          </>
        )}
      </div>
    </Drawer>
  );
}
