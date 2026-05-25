import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSkuDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: '价格（分）' })
  @IsOptional() @IsInt() @Min(1)
  price?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  durationMin?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  deliveryHour?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}
