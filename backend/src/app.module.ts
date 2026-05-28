import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MasterModule } from './master/master.module';
import { AdminModule } from './admin/admin.module';
import { PaymentModule } from './payment/payment.module';
import { ConversationModule } from './conversation/conversation.module';
import { OrderModule } from './order/order.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    MasterModule,
    AdminModule,
    PaymentModule,
    ConversationModule,
    OrderModule,
  ],
})
export class AppModule {}
