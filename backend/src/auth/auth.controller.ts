import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginWechatDto } from './dto/login-wechat.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login/wechat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户微信登录 (wx.login → code → JWT)' })
  loginWechat(@Body() dto: LoginWechatDto) {
    return this.authService.loginWithWechat(dto.code);
  }
}
