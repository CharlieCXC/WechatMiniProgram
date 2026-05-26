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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SkuService } from './sku.service';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';

@ApiTags('master-sku')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('MASTER')
@Controller('masters/me/skus')
export class SkuController {
  constructor(private readonly skus: SkuService) {}

  @Post()
  @ApiOperation({ summary: '创建 SKU' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSkuDto) {
    return this.skus.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '列出本人 SKU' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.skus.list(user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 SKU' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.skus.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '下架 SKU（置为 DISABLED）' })
  disable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.skus.disable(user.id, id);
  }
}
