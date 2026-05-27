import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondPriceChangeDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsString()
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision!: 'ACCEPTED' | 'REJECTED';
}
