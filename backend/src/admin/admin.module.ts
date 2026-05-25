import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { InviteService } from './invite.service';
import { AdminMasterService } from './admin-master.service';

@Module({
  controllers: [AdminController],
  providers: [InviteService, AdminMasterService],
})
export class AdminModule {}
