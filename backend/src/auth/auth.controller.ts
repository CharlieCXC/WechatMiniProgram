import {
  Body,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginWechatDto } from './dto/login-wechat.dto';
import { SendSmsDto } from './dto/send-sms.dto';
import { LoginMasterPhoneDto } from './dto/login-master-phone.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

interface AuthedRequest {
  user: AuthenticatedUser;
}

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

  @Post('sms/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送短信验证码 (师傅 H5 登录用)' })
  async sendSms(@Body() dto: SendSmsDto) {
    await this.authService.sendSmsCode(dto.phone);
    return { sent: true };
  }

  @Post('login/master')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '师傅手机号+验证码登录' })
  loginMaster(@Body() dto: LoginMasterPhoneDto) {
    return this.authService.loginMasterPhone(dto.phone, dto.code);
  }

  @Post('master/bind-unionid')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('MASTER')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '师傅绑定微信 unionid (扫码后调用)' })
  bindUnionid(@Req() req: AuthedRequest, @Body() dto: LoginWechatDto) {
    return this.authService.bindMasterUnionid(req.user.id, dto.code);
  }
}
