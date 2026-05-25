import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantBadgeDto {
  @ApiProperty({ description: '徽章名，如「严选」' })
  @IsString()
  @MaxLength(20)
  badge!: string;
}
