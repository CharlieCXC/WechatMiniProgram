import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService) {}

  get nodeEnv(): string {
    return this.config.getOrThrow<string>('NODE_ENV');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.config.getOrThrow<number>('PORT');
  }
  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }
  get redis() {
    return {
      host: this.config.getOrThrow<string>('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }
  get jwt() {
    return {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
      refreshExpiresIn: this.config.getOrThrow<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ),
    };
  }
  get wechat() {
    return {
      appId: this.config.getOrThrow<string>('WECHAT_APPID'),
      appSecret: this.config.getOrThrow<string>('WECHAT_APPSECRET'),
    };
  }
  get tencentSms() {
    return {
      secretId: this.config.getOrThrow<string>('TENCENT_SECRET_ID'),
      secretKey: this.config.getOrThrow<string>('TENCENT_SECRET_KEY'),
      sdkAppId: this.config.getOrThrow<string>('TENCENT_SMS_SDK_APP_ID'),
      signName: this.config.getOrThrow<string>('TENCENT_SMS_SIGN_NAME'),
      templateId: this.config.getOrThrow<string>('TENCENT_SMS_TEMPLATE_ID'),
    };
  }
  get corsOrigin(): string[] {
    return this.config
      .getOrThrow<string>('CORS_ORIGIN')
      .split(',')
      .map((s) => s.trim());
  }
}
