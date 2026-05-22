import { Module } from '@nestjs/common';
import { MasterService } from './master.service';

@Module({ providers: [MasterService], exports: [MasterService] })
export class MasterModule {}
