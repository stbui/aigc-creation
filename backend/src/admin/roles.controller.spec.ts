import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';

import { AdminRolesController } from './roles.controller';
import { UpdateRolePermissionsDto } from './dto/audit.dto';

function instance(input: Record<string, unknown>): UpdateRolePermissionsDto {
  return plainToInstance(UpdateRolePermissionsDto, input);
}

async function errorProperties(input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(instance(input));
  return errors.map((error) => error.property);
}

const validPayload = {
  roles: [
    { code: 'operator', permissions: ['user.read', 'ticket.handle'] },
    { code: 'finance', permissions: ['order.read'] },
  ],
  reason: '  新增工单处理职责，同步收窄财务权限  ',
};

describe('UpdateRolePermissionsDto', () => {
  it('批量保存必须填写 2–200 字的真实原因', async () => {
    const missing = await errorProperties({ roles: validPayload.roles });
    const whitespace = await errorProperties({ ...validPayload, reason: '   ' });
    const tooShort = await errorProperties({ ...validPayload, reason: '改' });
    const tooLong = await errorProperties({ ...validPayload, reason: '改'.repeat(201) });

    expect(missing).toContain('reason');
    expect(whitespace).toContain('reason');
    expect(tooShort).toContain('reason');
    expect(tooLong).toContain('reason');
  });

  it('校验角色 code、权限数组与重复权限点', async () => {
    const unknownRole = await errorProperties({
      ...validPayload,
      roles: [{ code: 'user', permissions: [] }],
    });
    const duplicatePermission = await errorProperties({
      ...validPayload,
      roles: [{ code: 'operator', permissions: ['user.read', 'user.read'] }],
    });

    expect(unknownRole.length).toBeGreaterThan(0);
    expect(duplicatePermission.length).toBeGreaterThan(0);
  });

  it('合法载荷会 trim 原因并保留嵌套角色', async () => {
    const dto = instance(validPayload);

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('新增工单处理职责，同步收窄财务权限');
    expect(dto.roles).toHaveLength(2);
    expect(dto.roles[0]).toBeInstanceOf(Object);
    expect(dto.roles[0].code).toBe('operator');
    expect(dto.roles[0].permissions).toEqual(['user.read', 'ticket.handle']);
  });
});

describe('AdminRolesController.updatePermissions', () => {
  it('把真实原因和逐角色权限差异写入审计上下文', async () => {
    const changes = [
      {
        code: 'operator',
        before: ['user.read'],
        after: ['user.read', 'ticket.handle'],
        added: ['ticket.handle'],
        removed: [],
      },
    ];
    const roles = {
      updatePermissions: vi.fn().mockResolvedValue(changes),
    };
    const controller = new AdminRolesController(roles as never);
    const req: { auditReason?: string; auditExtra?: Record<string, unknown> } = {};
    const dto = instance(validPayload);

    const result = await controller.updatePermissions(dto, req as never);

    expect(roles.updatePermissions).toHaveBeenCalledWith([
      { code: 'operator', permissions: ['user.read', 'ticket.handle'] },
      { code: 'finance', permissions: ['order.read'] },
    ]);
    expect(req.auditReason).toBe('新增工单处理职责，同步收窄财务权限');
    expect(req.auditExtra).toEqual({
      roleCodes: ['operator'],
      changes: [
        {
          code: 'operator',
          added: ['ticket.handle'],
          removed: [],
          beforeCount: 1,
          afterCount: 2,
        },
      ],
    });
    expect(result).toEqual({
      roles: [{ code: 'operator', permissions: ['user.read', 'ticket.handle'] }],
    });
  });
});
