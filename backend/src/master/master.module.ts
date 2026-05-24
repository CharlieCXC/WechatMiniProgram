import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';

@Module({
  controllers: [OnboardingController],
  providers: [MasterService, OnboardingService],
  exports: [MasterService],
})
export class MasterModule {}
