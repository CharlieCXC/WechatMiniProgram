import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InviteService } from './invite.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly invites: InviteService) {}

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
}
