import {
  IsArray,
  IsOptional,
  IsString,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PolishProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  avatar?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  intro?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  philosophy?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  experience?: string;

  @ApiPropertyOptional({ example: ['八字'] })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @IsString({ each: true }) @MaxLength(20, { each: true })
  methods?: string[];

  @ApiPropertyOptional({ example: ['感情咨询'] })
  @IsOptional() @IsArray() @ArrayMaxSize(10)
  @IsString({ each: true }) @MaxLength(20, { each: true })
  topics?: string[];
}
