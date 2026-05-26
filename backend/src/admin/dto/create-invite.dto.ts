import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiPropertyOptional({ description: '备注：邀请给谁' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
