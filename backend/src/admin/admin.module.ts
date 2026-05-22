import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { InviteService } from './invite.service';

@Module({
  controllers: [AdminController],
  providers: [InviteService],
})
export class AdminModule {}
