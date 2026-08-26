import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@rare-fish/db';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient;

  constructor(client: PrismaClient) {
    this.db = client;
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
