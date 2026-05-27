import { Module, forwardRef } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MasterOrderController } from './master-order.controller';
import { PriceChangeService } from './price-change.service';
import { ExtensionService } from './extension.service';
import { ConversationModule } from '../conversation/conversation.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [ConversationModule, forwardRef(() => PaymentModule)],
  controllers: [OrderController, MasterOrderController],
  providers: [OrderService, PriceChangeService, ExtensionService],
  exports: [OrderService],
})
export class OrderModule {}
