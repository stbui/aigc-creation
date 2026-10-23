import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { AccountService } from './account.service';
import { AccountLifecycleService } from './account-lifecycle.service';
import { ChangePasswordDto, DeleteAccountDto, UpdateProfileDto } from './dto/account.dto';

/**
 * 账户自助。
 *
 * 路径用 `/me` 而不是 `/users/:id`：后者的 :id 一旦漏校验就是越权，
 * 而 `/me` 在路由层面就没有"别人的账号"这个概念。
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

  @Get()
  async profile(@CurrentUser() user: AuthUser) {
    return this.account.profile(user.id);
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(user.id, dto);
  }

  /** 改密成功后旧 token 全部失效（含当前这把），前端需跳登录 */
  @Post('password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }

  /** 个人信息导出（JSON，同步返回） */
  @Post('export')
  async export(@CurrentUser() user: AuthUser) {
    return this.account.export(user.id);
  }

  /** 注销前影响面预览 */
  @Get('deletion-preview')
  async deletionPreview(@CurrentUser() user: AuthUser) {
    return this.lifecycle.impact(user.id);
  }

  /** 自助注销（密码 + 确认词「注销」） */
  @Delete()
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.account.deleteAccount(user.id, dto.password, dto.confirm);
  }
}
