import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectOrderDto {
  @ApiProperty({ description: '拒单原因' })
  @IsString()
  @MaxLength(200)
  reason!: string;
}
