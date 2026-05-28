import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WechatPayNotifyDto {
  @ApiProperty({ description: 'stub: 微信返回的 out_trade_no' })
  @IsString()
  outTradeNo!: string;
}
