import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';
import { SkuService } from './sku.service';
import { SkuController } from './sku.controller';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';

@Module({
  controllers: [
    OnboardingController,
    MasterController,
    SkuController,
    ScheduleController,
  ],
  providers: [
    MasterService,
    OnboardingService,
    ProfileService,
    SkuService,
    ScheduleService,
  ],
  exports: [MasterService],
})
export class MasterModule {}
