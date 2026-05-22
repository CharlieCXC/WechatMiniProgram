import { Test } from '@nestjs/testing';
import { WechatService } from './wechat.service';
import { AppConfigService } from '../config/config.service';

describe('WechatService', () => {
  let service: WechatService;
  let mockHttp: jest.Mock;

  beforeEach(async () => {
    mockHttp = jest.fn();
    global.fetch = mockHttp as unknown as typeof fetch;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatService,
        {
          provide: AppConfigService,
          useValue: {
            wechat: { appId: 'wx_test', appSecret: 'secret_test' },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(WechatService);
  });

  describe('code2Session', () => {
    it('returns openid + session_key on success', async () => {
      mockHttp.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          openid: 'wx_openid_abc',
          session_key: 'session_key_xyz',
          unionid: 'wx_union_123',
        }),
      });

      const result = await service.code2Session('mock_code');
      expect(result).toEqual({
        openid: 'wx_openid_abc',
        sessionKey: 'session_key_xyz',
        unionid: 'wx_union_123',
      });
      expect(mockHttp).toHaveBeenCalledWith(
        expect.stringContaining('appid=wx_test'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws when WeChat returns errcode', async () => {
      mockHttp.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
      });

      await expect(service.code2Session('bad_code')).rejects.toThrow(
        /invalid code/,
      );
    });
  });
});
