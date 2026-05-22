import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { SmsService } from '../sms/sms.service';
import { MasterService } from '../master/master.service';
import { RedisService } from '../redis/redis.service';
import { AppConfigService } from '../config/config.service';

export type Role = 'USER' | 'MASTER' | 'ADMIN';
export interface JwtPayload {
  sub: string;
  role: Role;
}
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly wechat: WechatService,
    private readonly users: UserService,
    private readonly sms: SmsService,
    private readonly masters: MasterService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async loginWithWechat(code: string): Promise<LoginResult> {
    const { openid, unionid } = await this.wechat.code2Session(code);
    const user = await this.users.findOrCreateByOpenid(openid, unionid);
    return this.issueTokens(user.id, 'USER');
  }

  async sendSmsCode(phone: string): Promise<void> {
    const rateKey = `sms:rate:${phone}`;
    const recent = await this.redis.get(rateKey);
    if (recent) {
      throw new BadRequestException('发送频繁，请稍后再试');
    }
    const code = this.generateSixDigitCode();
    await this.redis.set(`sms:code:${phone}`, code, 'EX', 300);
    await this.redis.set(rateKey, '1', 'EX', 60);
    await this.sms.sendVerificationCode(phone, code);
  }

  async loginMasterPhone(phone: string, code: string): Promise<LoginResult> {
    const stored = await this.redis.get(`sms:code:${phone}`);
    if (!stored) {
      throw new BadRequestException('验证码已过期，请重新发送');
    }
    if (stored !== code) {
      throw new BadRequestException('验证码错误');
    }
    await this.redis.del(`sms:code:${phone}`);
    const master = await this.masters.findOrCreateByPhone(phone);
    return this.issueTokens(master.id, 'MASTER');
  }

  async bindMasterUnionid(
    masterId: string,
    code: string,
  ): Promise<{ unionid: string }> {
    const { unionid } = await this.wechat.code2Session(code);
    if (!unionid) {
      throw new BadRequestException('微信未返回 unionid，请确保已绑定开放平台');
    }
    await this.masters.bindUnionid(masterId, unionid);
    return { unionid };
  }

  private issueTokens(subjectId: string, role: Role): LoginResult {
    const payload: JwtPayload = { sub: subjectId, role };
    const accessOpts: JwtSignOptions = {
      expiresIn: this.config.jwt.expiresIn as JwtSignOptions['expiresIn'],
    };
    const refreshOpts: JwtSignOptions = {
      expiresIn: this.config.jwt
        .refreshExpiresIn as JwtSignOptions['expiresIn'],
    };
    return {
      accessToken: this.jwt.sign(payload, accessOpts),
      refreshToken: this.jwt.sign(payload, refreshOpts),
      userId: subjectId,
    };
  }

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
