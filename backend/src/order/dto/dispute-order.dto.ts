import { IsArray, IsString, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisputeOrderDto {
  @ApiProperty({ description: '异议原因（模板词）' })
  @IsString()
  @MaxLength(100)
  reason!: string;

  @ApiProperty({ description: '详细说明' })
  @IsString()
  @MaxLength(2000)
  userStatement!: string;

  @ApiProperty({ description: '证据图 URL 数组', example: [] })
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  evidence!: string[];
}
