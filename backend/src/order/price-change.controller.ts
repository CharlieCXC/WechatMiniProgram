import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PriceChangeService } from './price-change.service';
import { ProposePriceChangeDto } from './dto/propose-price-change.dto';
import { RespondPriceChangeDto } from './dto/respond-price-change.dto';

@ApiTags('price-changes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class PriceChangeController {
  constructor(private readonly priceChanges: PriceChangeService) {}

  @Post('masters/me/orders/:orderId/price-changes')
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅发起改价' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ProposePriceChangeDto,
  ) {
    return this.priceChanges.propose(user.id, orderId, dto);
  }

  @Post('orders/:orderId/price-changes/:id/respond')
  @Roles('USER')
  @ApiOperation({ summary: '用户回应改价' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RespondPriceChangeDto,
  ) {
    return this.priceChanges.respond(user.id, id, dto.decision);
  }
}
