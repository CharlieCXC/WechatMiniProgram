import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { sms } from 'tencentcloud-sdk-nodejs-sms';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: InstanceType<typeof sms.v20210111.Client>;

  constructor(private readonly config: AppConfigService) {
    this.client = new sms.v20210111.Client({
      credential: {
        secretId: config.tencentSms.secretId,
        secretKey: config.tencentSms.secretKey,
      },
      region: 'ap-guangzhou',
    });
  }

  async sendVerificationCode(phone: string, code: string): Promise<void> {
    const params = {
      SmsSdkAppId: this.config.tencentSms.sdkAppId,
      SignName: this.config.tencentSms.signName,
      TemplateId: this.config.tencentSms.templateId,
      TemplateParamSet: [code],
      PhoneNumberSet: [`+86${phone}`],
    };

    const resp = await this.client.SendSms(params);
    const status = resp.SendStatusSet?.[0];
    if (!status || status.Code !== 'Ok') {
      this.logger.warn(`SMS failed: ${status?.Code} ${status?.Message}`);
      throw new BadRequestException(
        `SMS send failed: ${status?.Code} ${status?.Message}`,
      );
    }
  }
}
