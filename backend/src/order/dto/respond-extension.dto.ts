import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RespondExtensionDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsString()
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision!: 'ACCEPTED' | 'REJECTED';
}
