import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProposePriceChangeDto {
  @ApiProperty({ description: '新价格（分）' })
  @IsInt()
  @Min(1)
  newPrice!: number;

  @ApiProperty({ description: '调整原因' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
