import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('master-profile')
@Controller('masters')
export class MasterController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅获取本人 profile' })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.profile.getMyProfile(user.id);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MASTER')
  @ApiOperation({ summary: '师傅编辑本人 profile' })
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profile.updateProfile(user.id, dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '公开获取已上架师傅 profile' })
  getPublic(@Param('id') id: string) {
    return this.profile.getPublicProfile(id);
  }
}
