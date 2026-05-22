import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

export interface Code2SessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  constructor(private readonly config: AppConfigService) {}

  async code2Session(code: string): Promise<Code2SessionResult> {
    const { appId, appSecret } = this.config.wechat;
    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;

    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      throw new BadRequestException(`WeChat code2session HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      openid?: string;
      session_key?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode) {
      this.logger.warn(
        `code2session errcode=${data.errcode} msg=${data.errmsg}`,
      );
      throw new BadRequestException(`WeChat code2session: ${data.errmsg}`);
    }
    return {
      openid: data.openid!,
      sessionKey: data.session_key!,
      unionid: data.unionid,
    };
  }
}
