import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service health check (mysql + redis)' })
  async check(@Res({ passthrough: true }) res: Response) {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis
        .ping()
        .then((r) => r === 'PONG')
        .catch(() => false),
    ]);
    const healthy = dbOk && redisOk;
    if (!healthy) {
      res.status(503);
    }
    return {
      status: healthy ? 'ok' : 'degraded',
      mysql: dbOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
    };
  }
}
