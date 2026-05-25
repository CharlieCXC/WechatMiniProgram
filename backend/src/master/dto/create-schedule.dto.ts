import { IsInt, IsString, Min, Max, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScheduleDto {
  @ApiProperty({ description: '星期几（0=周日 ... 6=周六）' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ description: '开始时间 HH:mm', example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  startTime!: string;

  @ApiProperty({ description: '结束时间 HH:mm', example: '12:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  endTime!: string;
}
