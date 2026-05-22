import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { WechatService } from '../wechat/wechat.service';
import { UserService } from '../user/user.service';
import { AppConfigService } from '../config/config.service';
import { SmsService } from '../sms/sms.service';
import { MasterService } from '../master/master.service';
import { RedisService } from '../redis/redis.service';

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
        {
          provide: AppConfigService,
          useValue: {
            jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' },
          },
        },
        { provide: SmsService, useValue: { sendVerificationCode: jest.fn() } },
        {
          provide: MasterService,
          useValue: { findOrCreateByPhone: jest.fn(), bindUnionid: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('loginWithWechat', () => {
    it('exchanges code, finds/creates user, returns JWT pair', async () => {
      wechat.code2Session.mockResolvedValue({
        openid: 'wx_abc',
        sessionKey: 'sk',
        unionid: 'wx_uni',
      });
      userSvc.findOrCreateByOpenid.mockResolvedValue({
        id: 'u1',
        openid: 'wx_abc',
        unionid: 'wx_uni',
      });
      jwt.sign
        .mockReturnValueOnce('access_jwt')
        .mockReturnValueOnce('refresh_jwt');
      const result = await service.loginWithWechat('mock_code');
      expect(wechat.code2Session).toHaveBeenCalledWith('mock_code');
      expect(userSvc.findOrCreateByOpenid).toHaveBeenCalledWith(
        'wx_abc',
        'wx_uni',
      );
      expect(result).toEqual({
        accessToken: 'access_jwt',
        refreshToken: 'refresh_jwt',
        userId: 'u1',
      });
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ sub: 'u1', role: 'USER' }),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });
  });
});

describe('AuthService (sms + master phone login)', () => {
  let service: AuthService;
  let sms: { sendVerificationCode: jest.Mock };
  let masters: { findOrCreateByPhone: jest.Mock };
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    sms = { sendVerificationCode: jest.fn() };
    masters = { findOrCreateByPhone: jest.fn() };
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    jwt = { sign: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: WechatService, useValue: { code2Session: jest.fn() } },
        { provide: UserService, useValue: { findOrCreateByOpenid: jest.fn() } },
        { provide: SmsService, useValue: sms },
        { provide: MasterService, useValue: masters },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwt },
        {
          provide: AppConfigService,
          useValue: {
            jwt: { secret: 's', expiresIn: '7d', refreshExpiresIn: '30d' },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('sendSmsCode', () => {
    it('generates a 6-digit code, stores in Redis 5min, sends via SMS', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue('OK');
      await service.sendSmsCode('13800138000');
      expect(redis.set).toHaveBeenCalledWith(
        'sms:code:13800138000',
        expect.stringMatching(/^\d{6}$/),
        'EX',
        300,
      );
      expect(sms.sendVerificationCode).toHaveBeenCalledWith(
        '13800138000',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('rate-limits: rejects if recent code sent within 60s', async () => {
      redis.get.mockResolvedValue('1');
      await expect(service.sendSmsCode('13800138000')).rejects.toThrow(/频繁/);
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('loginMasterPhone', () => {
    it('verifies code, finds/creates master, returns JWT pair', async () => {
      redis.get.mockResolvedValueOnce('123456');
      masters.findOrCreateByPhone.mockResolvedValue({
        id: 'm1',
        phone: '13800138000',
      });
      jwt.sign.mockReturnValueOnce('access').mockReturnValueOnce('refresh');
      const r = await service.loginMasterPhone('13800138000', '123456');
      expect(redis.get).toHaveBeenCalledWith('sms:code:13800138000');
      expect(redis.del).toHaveBeenCalledWith('sms:code:13800138000');
      expect(masters.findOrCreateByPhone).toHaveBeenCalledWith('13800138000');
      expect(r).toEqual({
        accessToken: 'access',
        refreshToken: 'refresh',
        userId: 'm1',
      });
    });

    it('rejects when stored code does not match', async () => {
      redis.get.mockResolvedValueOnce('654321');
      await expect(
        service.loginMasterPhone('13800138000', '123456'),
      ).rejects.toThrow(BadRequestException);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects when no code exists (expired)', async () => {
      redis.get.mockResolvedValueOnce(null);
      await expect(
        service.loginMasterPhone('13800138000', '123456'),
      ).rejects.toThrow(/验证码已过期/);
    });
  });
});
