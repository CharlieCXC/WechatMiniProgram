import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { AppConfigService } from '../config/config.service';

export type Role = 'USER' | 'MASTER' | 'ADMIN';
export interface JwtPayload { sub: string; role: Role; }
export interface LoginResult { accessToken: string; refreshToken: string; userId: string; }

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async loginWithWechat(code: string): Promise<LoginResult> {
    const { openid, unionid } = await this.wechat.code2Session(code);
    const user = await this.users.findOrCreateByOpenid(openid, unionid);
    return this.issueTokens(user.id, 'USER');
  }

  private issueTokens(subjectId: string, role: Role): LoginResult {
    const payload: JwtPayload = { sub: subjectId, role };
    const accessOpts: JwtSignOptions = { expiresIn: this.config.jwt.expiresIn as JwtSignOptions['expiresIn'] };
    const refreshOpts: JwtSignOptions = { expiresIn: this.config.jwt.refreshExpiresIn as JwtSignOptions['expiresIn'] };
    return {
      accessToken: this.jwt.sign(payload, accessOpts),
      refreshToken: this.jwt.sign(payload, refreshOpts),
      userId: subjectId,
    };
  }
}
