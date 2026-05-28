import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { DisputeOrderDto } from './dto/dispute-order.dto';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('USER')
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建订单' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.orders.createOrder(user.id, dto.skuId);
  }

  @Get()
  @ApiOperation({ summary: '列出本人订单' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（仅本人）' })
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== user.id) {
      throw new NotFoundException('订单不存在');
    }
    return order;
  }

  @Post(':id/pay')
  @ApiOperation({ summary: '申请支付（返回 stub 支付参数）' })
  pay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    // openid placeholder for MVP; real impl will look it up from user record
    return this.orders.requestPayment(user.id, id, `openid_${user.id}`);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消订单' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.cancelOrder(user.id, id);
  }

  @Post(':id/confirm-delivery')
  @ApiOperation({ summary: '确认收货' })
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.confirmDelivery(user.id, id);
  }

  @Post(':id/dispute')
  @ApiOperation({ summary: '发起异议' })
  dispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeOrderDto,
  ) {
    return this.orders.disputeOrder(user.id, id, dto);
  }
}
