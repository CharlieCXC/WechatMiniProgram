import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'mysql://x:y@localhost:3306/z',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRES_IN: '7d',
    JWT_REFRESH_EXPIRES_IN: '30d',
    WECHAT_APPID: 'wx_test',
    WECHAT_APPSECRET: 'secret',
    TENCENT_SECRET_ID: 'id',
    TENCENT_SECRET_KEY: 'key',
    TENCENT_SMS_SDK_APP_ID: '1400000000',
    TENCENT_SMS_SIGN_NAME: '搜个仙儿',
    TENCENT_SMS_TEMPLATE_ID: '000000',
    CORS_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'info',
  };

  it('accepts a valid env object', () => {
    const { error } = envValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
  });

  it('rejects JWT_SECRET shorter than 32 chars', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      JWT_SECRET: 'tooshort',
    });
    expect(error).toBeDefined();
    expect(error?.details[0].message).toMatch(/JWT_SECRET/);
  });

  it('rejects invalid NODE_ENV', () => {
    const { error } = envValidationSchema.validate({
      ...validEnv,
      NODE_ENV: 'staging',
    });
    expect(error).toBeDefined();
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _unused, ...without } = validEnv;
    const { error } = envValidationSchema.validate(without);
    expect(error).toBeDefined();
    expect(error?.details[0].message).toMatch(/DATABASE_URL/);
  });
});
