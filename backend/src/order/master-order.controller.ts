import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OrderService } from './order.service';
import { RejectOrderDto } from './dto/reject-order.dto';
import { DeliverOrderDto } from './dto/deliver-order.dto';

@ApiTags('master-orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/orders')
export class MasterOrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出本人订单' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.order.findMany({
      where: { masterId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post(':id/accept')
  @ApiOperation({ summary: '接单' })
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.acceptOrder(user.id, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: '拒单' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
  ) {
    return this.orders.rejectOrder(user.id, id, dto.reason);
  }

  @Post(':id/deliver')
  @ApiOperation({ summary: '交付（上传 artifact URL）' })
  deliver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeliverOrderDto,
  ) {
    return this.orders.deliverOrder(user.id, id, dto);
  }
}
