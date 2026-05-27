import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ExtensionService } from './extension.service';
import { ProposeExtensionDto } from './dto/propose-extension.dto';
import { RespondExtensionDto } from './dto/respond-extension.dto';

@ApiTags('extensions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class ExtensionController {
  constructor(private readonly extensions: ExtensionService) {}

  @Post('masters/me/orders/:orderId/extensions')
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅申请延期' })
  propose(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: ProposeExtensionDto,
  ) {
    return this.extensions.propose(user.id, orderId, dto);
  }

  @Post('orders/:orderId/extensions/:id/respond')
  @Roles('USER')
  @ApiOperation({ summary: '用户回应延期' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RespondExtensionDto,
  ) {
    return this.extensions.respond(user.id, id, dto.decision);
  }
}
