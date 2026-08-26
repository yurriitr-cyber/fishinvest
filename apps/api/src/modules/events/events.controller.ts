import { Controller, Get, UseGuards } from '@nestjs/common';
import { TmaAuthGuard } from '../auth/tma-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('events')
@UseGuards(TmaAuthGuard)
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const now = new Date();
    const events = await this.prisma.db.marketEvent.findMany({
      where: {
        isActive: true,
        endTime: { gte: now },
      },
      orderBy: { startTime: 'asc' },
      include: { fish: { select: { symbol: true, name: true } } },
    });

    return events.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      priceMultiplier: e.priceMultiplier.toFixed(4),
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      fish: e.fish
        ? { symbol: e.fish.symbol, name: e.fish.name }
        : null,
    }));
  }
}
