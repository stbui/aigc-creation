import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app.exception';
import { JwtService } from '../common/jwt.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** 后台角色: 'user' | 'admin' | 'operator' | 'finance' */
  role: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  // 注册后直接签发 token (前端 LoginPage 注册模式同样消费 accessToken 自动登录)
  async register(dto: RegisterDto): Promise<{ accessToken: string; user: PublicUser }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new AppError(40001, '该邮箱已注册', 400);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });
      const accessToken = JwtService.sign({ sub: user.id, email: user.email });
      return { accessToken, user: this.toPublic(user) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(40001, '该邮箱已注册', 400);
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; user: PublicUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new AppError(40101, '邮箱或密码错误', 401);
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new AppError(40101, '邮箱或密码错误', 401);
    }

    // 已注销/已禁用账号拒绝登录: 与 AdminGuard 的判定同源, 避免后台禁用后
    // 用户仍能凭旧密码重新登录拿到 token (后台判定虽然会拦, 但 C 端登录页
    // 会表现为"登录成功但一切请求 403", 体验上无法解释)。
    if (user.status === 'disabled') {
      throw new AppError(40302, '账号已被禁用', 403);
    }
    if (user.status === 'deleted') {
      throw new AppError(40302, '账号已注销', 403);
    }

    // 记录最近登录时间 (后台用户列表展示用)。失败不影响登录本身。
    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    const accessToken = JwtService.sign({ sub: user.id, email: user.email });
    return { accessToken, user: this.toPublic(user) };
  }

  private toPublic(user: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    role: string;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      role: user.role,
    };
  }
}
