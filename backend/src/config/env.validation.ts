import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  WECHAT_APPID: Joi.string().required(),
  WECHAT_APPSECRET: Joi.string().required(),

  TENCENT_SECRET_ID: Joi.string().required(),
  TENCENT_SECRET_KEY: Joi.string().required(),
  TENCENT_SMS_SDK_APP_ID: Joi.string().required(),
  TENCENT_SMS_SIGN_NAME: Joi.string().required(),
  TENCENT_SMS_TEMPLATE_ID: Joi.string().required(),

  CORS_ORIGIN: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'verbose')
    .default('info'),
});
