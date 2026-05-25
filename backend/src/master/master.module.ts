import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { ProfileService } from './profile.service';
import { MasterController } from './master.controller';

@Module({
  controllers: [OnboardingController, MasterController],
  providers: [MasterService, OnboardingService, ProfileService],
  exports: [MasterService],
})
export class MasterModule {}
