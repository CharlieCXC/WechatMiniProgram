import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';
import { SkuService } from './sku.service';
import { SkuController } from './sku.controller';

@Module({
  controllers: [OnboardingController, MasterController, SkuController],
  providers: [MasterService, OnboardingService, ProfileService, SkuService],
  exports: [MasterService],
})
export class MasterModule {}
