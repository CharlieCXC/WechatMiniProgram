import { IsString, Matches, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginMasterPhoneDto {
  @ApiProperty({ description: '手机号' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @ApiProperty({ description: '6 位短信验证码' })
  @IsString()
  @Length(6, 6)
  code!: string;
}
