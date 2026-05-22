import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginWechatDto {
  @ApiProperty({ description: '微信 wx.login 返回的 code' })
  @IsString()
  @MinLength(1)
  code!: string;
}
