import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RedeemInviteDto {
  @ApiProperty({ description: '8 位邀请码' })
  @IsString()
  @Length(8, 8)
  code!: string;
}
