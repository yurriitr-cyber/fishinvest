import { PrismaClient, FishRarity } from '@prisma/client';
import { generateReferralCode } from '@rare-fish/shared';

const prisma = new PrismaClient();

/**
 * Price ladder: cheapest ~100 fish / 1⭐ (0.01), mythic up to ~1000⭐.
 * Supply shrinks as price rises. Volatility falls as price rises.
 */
const FISH_SEED: Array<{
  symbol: string;
  name: string;
  rarity: FishRarity;
  price: number;
  supply: number;
  volatility: number;
  trend: number;
  /** Served from the Mini App static host at /fish/<symbol>.jpg */
  hasArt?: boolean;
}> = [
  { symbol: 'GLDFSH', name: 'Glitch Goldfish', rarity: FishRarity.COMMON, price: 0.017, supply: 50_000_000, volatility: 0.42, trend: 0.002, hasArt: true },
  { symbol: 'NEON', name: 'Neon Tetra', rarity: FishRarity.COMMON, price: 0.034, supply: 40_000_000, volatility: 0.4, trend: 0.003, hasArt: true },
  { symbol: 'CATFSH', name: 'Abyss Catfish', rarity: FishRarity.COMMON, price: 0.085, supply: 25_000_000, volatility: 0.36, trend: 0.004, hasArt: true },
  { symbol: 'CLOWN', name: 'Anomaly Clownfish', rarity: FishRarity.RARE, price: 0.17, supply: 10_000_000, volatility: 0.32, trend: 0.005, hasArt: true },
  { symbol: 'HORSE', name: 'Pixel Seahorse', rarity: FishRarity.RARE, price: 0.425, supply: 8_000_000, volatility: 0.28, trend: 0.006, hasArt: true },
  { symbol: 'DGUPPY', name: 'Diamond Guppy', rarity: FishRarity.RARE, price: 0.85, supply: 5_000_000, volatility: 0.25, trend: 0.008, hasArt: true },
  { symbol: 'PIRANA', name: 'Chaos Piranha', rarity: FishRarity.RARE, price: 1.7, supply: 4_500_000, volatility: 0.22, trend: 0.01, hasArt: true },
  { symbol: 'CBETTA', name: 'Cosmic Betta', rarity: FishRarity.EPIC, price: 4.25, supply: 2_000_000, volatility: 0.18, trend: 0.01, hasArt: true },
  { symbol: 'BARRA', name: 'Laser Barracuda', rarity: FishRarity.EPIC, price: 8.5, supply: 1_500_000, volatility: 0.15, trend: 0.008, hasArt: true },
  { symbol: 'QKOI', name: 'Quantum Koi', rarity: FishRarity.EPIC, price: 20.4, supply: 1_250_000, volatility: 0.12, trend: 0.012, hasArt: true },
  { symbol: 'ANGEL', name: 'Moon Angel', rarity: FishRarity.EPIC, price: 59.5, supply: 1_000_000, volatility: 0.1, trend: 0.01, hasArt: true },
  { symbol: 'AROWANA', name: 'Golden Arowana', rarity: FishRarity.LEGENDARY, price: 136, supply: 900_000, volatility: 0.08, trend: 0.015, hasArt: true },
  { symbol: 'EPUFFER', name: 'Emperor Puffer', rarity: FishRarity.LEGENDARY, price: 255, supply: 800_000, volatility: 0.065, trend: 0.01, hasArt: true },
  { symbol: 'ASHARK', name: 'Albino Shark', rarity: FishRarity.LEGENDARY, price: 476, supply: 50_000, volatility: 0.055, trend: 0.012, hasArt: true },
  { symbol: 'BDRAGON', name: 'Black Dragonfish', rarity: FishRarity.LEGENDARY, price: 765, supply: 10_000, volatility: 0.045, trend: 0.015, hasArt: true },
  // Top mythics (≥600 ladder): ×3 vs previous seed
  { symbol: 'STING', name: 'Void Stingray', rarity: FishRarity.MYTHIC, price: 1950, supply: 5_000, volatility: 0.035, trend: 0.01, hasArt: true },
  { symbol: 'MANTA', name: 'Deep Manta', rarity: FishRarity.MYTHIC, price: 2550, supply: 2_000, volatility: 0.028, trend: 0.012, hasArt: true },
  { symbol: 'MWHALE', name: 'Mega Whale', rarity: FishRarity.MYTHIC, price: 3000, supply: 1_000, volatility: 0.02, trend: 0.008, hasArt: true },
];

function fishImageUrl(symbol: string, hasArt?: boolean) {
  return hasArt ? `/fish/${symbol}.jpg` : null;
}

async function main() {
  console.log('Seeding fish (price ladder + supply)…');

  for (let i = 0; i < FISH_SEED.length; i++) {
    const f = FISH_SEED[i];
    const bounds = {
      minPrice: Math.max(0.001, f.price * 0.2),
      maxPrice: Math.max(f.price * 4, f.price + 1),
    };

    await prisma.fish.upsert({
      where: { symbol: f.symbol },
      update: {
        name: f.name,
        rarity: f.rarity,
        currentPrice: f.price,
        previousPrice: f.price,
        allTimeHigh: f.price,
        allTimeLow: f.price,
        volatility: f.volatility,
        trend: f.trend,
        imageUrl: fishImageUrl(f.symbol, f.hasArt),
        ...bounds,
        totalSupply: f.supply,
        sortOrder: i,
      },
      create: {
        symbol: f.symbol,
        name: f.name,
        rarity: f.rarity,
        currentPrice: f.price,
        previousPrice: f.price,
        allTimeHigh: f.price,
        allTimeLow: f.price,
        volatility: f.volatility,
        trend: f.trend,
        momentum: 0,
        imageUrl: fishImageUrl(f.symbol, f.hasArt),
        ...bounds,
        totalSupply: f.supply,
        availableSupply: f.supply,
        sortOrder: i,
      },
    });

    const row = await prisma.fish.findUniqueOrThrow({ where: { symbol: f.symbol } });
    const held = await prisma.portfolioPosition.aggregate({
      where: { fishId: row.id },
      _sum: { quantity: true },
    });
    const heldQty = Math.floor(Number(held._sum.quantity ?? 0));
    await prisma.fish.update({
      where: { id: row.id },
      data: {
        totalSupply: f.supply,
        availableSupply: Math.max(0, f.supply - heldQty),
      },
    });
  }

  const providers = [
    { code: 'TELEGRAM_STARS' as const, isEnabled: true, feePercent: 0 },
    { code: 'TON' as const, isEnabled: false, feePercent: 0 },
    { code: 'TELEGRAM_GIFT' as const, isEnabled: false, feePercent: 0 },
    { code: 'CRYPTO' as const, isEnabled: false, feePercent: 0 },
  ];

  for (const p of providers) {
    await prisma.paymentProviderConfig.upsert({
      where: { code: p.code },
      update: { isEnabled: p.isEnabled, feePercent: p.feePercent },
      create: p,
    });
  }

  await prisma.exchangeRate.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: { rate: 1 },
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      fromAsset: 'STARS_EQUIVALENT',
      toAsset: 'GAME_CREDIT',
      rate: 1,
      effectiveFrom: new Date(),
    },
  });

  await prisma.exchangeRate.upsert({
    where: { id: '00000000-0000-4000-8000-000000000002' },
    update: { rate: 1 },
    create: {
      id: '00000000-0000-4000-8000-000000000002',
      fromAsset: 'REAL_TELEGRAM_STAR',
      toAsset: 'GAME_CREDIT',
      rate: 1,
      effectiveFrom: new Date(),
    },
  });

  console.log(`Seeded ${FISH_SEED.length} fish with supply + price ladder.`);

  /**
   * Casino cases — house edge ~18–25% vs seed prices.
   * Weights = relative odds; cheaper fish dominate, mythics are chase.
   */
  /**
   * Ticket price is derived at request time from the live expected value, so the
   * numbers below are only a floor plus the target house margin. Cheap crates
   * keep a fatter margin; the deep-water crates reward progression.
   */
  const CASE_SEED: Array<{
    code: string;
    name: string;
    description: string;
    priceCredits: number;
    edgePercent: number;
    sortOrder: number;
    rewards: Array<{ symbol: string; weight: number }>;
  }> = [
    {
      code: 'TIDE',
      name: 'Tide Crate',
      description: 'Shallow waters. Cheap opens, mostly common bait fish.',
      priceCredits: 0.01,
      edgePercent: 12,
      sortOrder: 0,
      rewards: [
        { symbol: 'GLDFSH', weight: 420 },
        { symbol: 'NEON', weight: 320 },
        { symbol: 'CATFSH', weight: 180 },
        { symbol: 'CLOWN', weight: 60 },
        { symbol: 'HORSE', weight: 18 },
        { symbol: 'DGUPPY', weight: 2 },
      ],
    },
    {
      code: 'REEF',
      name: 'Reef Chest',
      description: 'Coral shelf. Rares and the first epics.',
      priceCredits: 1,
      edgePercent: 10,
      sortOrder: 1,
      rewards: [
        { symbol: 'CLOWN', weight: 220 },
        { symbol: 'HORSE', weight: 180 },
        { symbol: 'DGUPPY', weight: 160 },
        { symbol: 'PIRANA', weight: 140 },
        { symbol: 'CBETTA', weight: 100 },
        { symbol: 'BARRA', weight: 70 },
        { symbol: 'QKOI', weight: 25 },
        { symbol: 'ANGEL', weight: 5 },
      ],
    },
    {
      code: 'ABYSS',
      name: 'Abyss Vault',
      description: 'Pressure zone. Epics guaranteed-feeling, legendaries lurk.',
      priceCredits: 10,
      edgePercent: 8,
      sortOrder: 2,
      rewards: [
        { symbol: 'CBETTA', weight: 160 },
        { symbol: 'BARRA', weight: 150 },
        { symbol: 'QKOI', weight: 140 },
        { symbol: 'ANGEL', weight: 120 },
        { symbol: 'AROWANA', weight: 90 },
        { symbol: 'EPUFFER', weight: 55 },
        { symbol: 'ASHARK', weight: 25 },
        { symbol: 'BDRAGON', weight: 8 },
        { symbol: 'STING', weight: 2 },
      ],
    },
    {
      code: 'LEVIATHAN',
      name: 'Leviathan Case',
      description: 'Deep money. Legendaries and mythic chase drops.',
      priceCredits: 50,
      edgePercent: 6,
      sortOrder: 3,
      rewards: [
        { symbol: 'ANGEL', weight: 140 },
        { symbol: 'AROWANA', weight: 160 },
        { symbol: 'EPUFFER', weight: 140 },
        { symbol: 'ASHARK', weight: 110 },
        { symbol: 'BDRAGON', weight: 80 },
        { symbol: 'STING', weight: 45 },
        { symbol: 'MANTA', weight: 25 },
        { symbol: 'MWHALE', weight: 10 },
      ],
    },
  ];

  console.log('Seeding casino cases…');
  for (const c of CASE_SEED) {
    const row = await prisma.lootCase.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        description: c.description,
        priceCredits: c.priceCredits,
        edgePercent: c.edgePercent,
        sortOrder: c.sortOrder,
        isActive: true,
      },
      create: {
        code: c.code,
        name: c.name,
        description: c.description,
        priceCredits: c.priceCredits,
        edgePercent: c.edgePercent,
        sortOrder: c.sortOrder,
        isActive: true,
      },
    });

    for (const r of c.rewards) {
      const fish = await prisma.fish.findUnique({ where: { symbol: r.symbol } });
      if (!fish) continue;
      await prisma.caseReward.upsert({
        where: { caseId_fishId: { caseId: row.id, fishId: fish.id } },
        update: { weight: r.weight, quantity: 1 },
        create: {
          caseId: row.id,
          fishId: fish.id,
          weight: r.weight,
          quantity: 1,
        },
      });
    }
  }

  console.log(`Seeded ${CASE_SEED.length} casino cases.`);
  console.log('Sample referral code generator:', generateReferralCode());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
