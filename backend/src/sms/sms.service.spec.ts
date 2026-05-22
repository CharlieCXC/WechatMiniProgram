import { Test } from '@nestjs/testing';
import { SmsService } from './sms.service';
import { AppConfigService } from '../config/config.service';

const mockSendSms = jest.fn();
jest.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: jest.fn().mockImplementation(() => ({
        SendSms: mockSendSms,
      })),
    },
  },
}));

describe('SmsService', () => {
  let service: SmsService;

  beforeEach(async () => {
    mockSendSms.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SmsService,
        {
          provide: AppConfigService,
          useValue: {
            tencentSms: {
              secretId: 'sid',
              secretKey: 'sk',
              sdkAppId: '1400000000',
              signName: '搜个仙儿',
              templateId: '000000',
            },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(SmsService);
  });

  it('sends a verification code via Tencent SMS', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800138000' }],
    });
    await service.sendVerificationCode('13800138000', '123456');
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        PhoneNumberSet: ['+8613800138000'],
        TemplateParamSet: ['123456'],
      }),
    );
  });

  it('throws when SMS returns non-Ok status', async () => {
    mockSendSms.mockResolvedValue({
      SendStatusSet: [
        {
          Code: 'LimitExceeded',
          PhoneNumber: '+8613800138000',
          Message: 'rate',
        },
      ],
    });
    await expect(
      service.sendVerificationCode('13800138000', '123456'),
    ).rejects.toThrow(/LimitExceeded/);
  });
});
