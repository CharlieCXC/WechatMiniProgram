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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';

@ApiTags('master-schedule')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/schedules')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @Post()
  @ApiOperation({ summary: '新增可预约时段' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedules.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出本人排期' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.schedules.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除一个时段' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.schedules.remove(user.id, id);
  }
}
