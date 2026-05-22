import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('auth-test')
@Controller('auth-test')
export class AuthTestController {
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  whoami(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, role: user.role };
  }

  @Get('admin-only')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  adminOnly() {
    return { secret: 'only admins see this' };
  }
}
