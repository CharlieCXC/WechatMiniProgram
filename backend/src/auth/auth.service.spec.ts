import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { AppConfigService } from '../config/config.service';

describe('AuthService', () => {
  let service: AuthService;
  let wechat: { code2Session: jest.Mock };
  let userSvc: { findOrCreateByOpenid: jest.Mock };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    wechat = { code2Session: jest.fn() };
    userSvc = { findOrCreateByOpenid: jest.fn() };
    jwt = { sign: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: WechatService, useValue: wechat },
        { provide: UserService, useValue: userSvc },
        { provide: JwtService, useValue: jwt },
        { provide: AppConfigService, useValue: { jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' } } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('loginWithWechat', () => {
    it('exchanges code, finds/creates user, returns JWT pair', async () => {
      wechat.code2Session.mockResolvedValue({ openid: 'wx_abc', sessionKey: 'sk', unionid: 'wx_uni' });
      userSvc.findOrCreateByOpenid.mockResolvedValue({ id: 'u1', openid: 'wx_abc', unionid: 'wx_uni' });
      jwt.sign.mockReturnValueOnce('access_jwt').mockReturnValueOnce('refresh_jwt');
      const result = await service.loginWithWechat('mock_code');
      expect(wechat.code2Session).toHaveBeenCalledWith('mock_code');
      expect(userSvc.findOrCreateByOpenid).toHaveBeenCalledWith('wx_abc', 'wx_uni');
      expect(result).toEqual({ accessToken: 'access_jwt', refreshToken: 'refresh_jwt', userId: 'u1' });
      expect(jwt.sign).toHaveBeenNthCalledWith(1, expect.objectContaining({ sub: 'u1', role: 'USER' }), expect.objectContaining({ expiresIn: '7d' }));
    });
  });
});
