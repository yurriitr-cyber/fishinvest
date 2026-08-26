import { Global, Module } from '@nestjs/common';
import { prisma } from '@rare-fish/db';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService(prisma),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
