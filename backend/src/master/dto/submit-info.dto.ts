import {
  IsArray,
  IsString,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitInfoDto {
  @ApiProperty({ description: '从业经历 / 师承' })
  @IsString()
  @MaxLength(2000)
  experience!: string;

  @ApiProperty({ description: '擅长方式（多选）', example: ['八字', '六爻'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  methods!: string[];

  @ApiProperty({ description: '擅长事项（多选）', example: ['事业咨询'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  topics!: string[];
}
