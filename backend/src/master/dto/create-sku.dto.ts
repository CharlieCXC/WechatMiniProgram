import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class CreateSkuDto {
  @ApiProperty({ description: 'SKU 名称' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: ServiceType, description: '异步报告 / 实时 IM' })
  @IsEnum(ServiceType)
  type!: ServiceType;

  @ApiProperty({ description: '价格（单位：分）' })
  @IsInt()
  @Min(1)
  price!: number;

  @ApiPropertyOptional({ description: '实时 IM 单次时长（分钟）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;

  @ApiPropertyOptional({ description: '异步报告承诺交付时长（小时）' })
  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryHour?: number;

  @ApiProperty({ description: '包含内容描述' })
  @IsString()
  @MaxLength(2000)
  description!: string;
}
