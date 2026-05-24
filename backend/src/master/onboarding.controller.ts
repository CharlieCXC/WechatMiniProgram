import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { OnboardingService } from './onboarding.service';
import { RedeemInviteDto } from './dto/redeem-invite.dto';
import { SubmitInfoDto } from './dto/submit-info.dto';

@ApiTags('master-onboarding')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('redeem-invite')
  @ApiOperation({ summary: '师傅兑换邀请码' })
  redeem(@CurrentUser() user: AuthenticatedUser, @Body() dto: RedeemInviteDto) {
    return this.onboarding.redeemInvite(user.id, dto.code);
  }

  @Post('submit-info')
  @ApiOperation({ summary: '师傅提交基础信息' })
  submitInfo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitInfoDto,
  ) {
    return this.onboarding.submitInfo(user.id, dto);
  }

  @Post('sign')
  @ApiOperation({ summary: '师傅签署平台公约' })
  sign(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.signAgreement(user.id);
  }
}
