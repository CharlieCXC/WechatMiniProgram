import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InviteService } from './invite.service';
import { AdminMasterService } from './admin-master.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { PolishProfileDto } from './dto/polish-profile.dto';
import { GrantBadgeDto } from './dto/grant-badge.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly invites: InviteService,
    private readonly masters: AdminMasterService,
  ) {}

  @Post('invites')
  @ApiOperation({ summary: '生成邀请码' })
  createInvite(@Body() dto: CreateInviteDto) {
    return this.invites.generate(dto.note);
  }

  @Get('invites')
  @ApiOperation({ summary: '列出全部邀请码' })
  listInvites() {
    return this.invites.list();
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: '作废一个未使用的邀请码' })
  revokeInvite(@Param('id') id: string) {
    return this.invites.revoke(id);
  }

  @Patch('masters/:id/profile')
  @ApiOperation({ summary: '创始人润色师傅 profile（→ PROFILE_DRAFTED）' })
  polishProfile(@Param('id') id: string, @Body() dto: PolishProfileDto) {
    return this.masters.polishProfile(id, dto);
  }

  @Post('masters/:id/badges')
  @ApiOperation({ summary: '授予师傅徽章' })
  grantBadge(@Param('id') id: string, @Body() dto: GrantBadgeDto) {
    return this.masters.grantBadge(id, dto.badge);
  }

  @Post('masters/:id/activate')
  @ApiOperation({ summary: '终审上架师傅（SIGNED → LIVE/ACTIVE）' })
  activate(@Param('id') id: string) {
    return this.masters.activate(id);
  }
}
