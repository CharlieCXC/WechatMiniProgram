import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ProposeExtensionDto {
  @ApiProperty({ description: '追加小时数 1-168' })
  @IsInt()
  @Min(1)
  @Max(168)
  additionalHours!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
