import { IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeliverOrderDto {
  @ApiProperty({ description: '交付物 URL（COS 上传后地址）' })
  @IsString()
  @IsUrl()
  @MaxLength(500)
  artifactUrl!: string;

  @ApiProperty({ description: '交付说明' })
  @IsString()
  @MaxLength(2000)
  description!: string;
}
