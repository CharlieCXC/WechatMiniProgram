import {
  IsArray,
  IsOptional,
  IsString,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '师傅名号' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatar?: string;

  @ApiPropertyOptional({ description: '简介（≤50 字）' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  intro?: string;

  @ApiPropertyOptional({ description: '解读理念' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  philosophy?: string;

  @ApiPropertyOptional({ description: '自述视频 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({ description: '从业经历 / 师承' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  experience?: string;

  @ApiPropertyOptional({ description: '擅长方式', example: ['八字'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  methods?: string[];

  @ApiPropertyOptional({ description: '擅长事项', example: ['感情咨询'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  topics?: string[];
}
