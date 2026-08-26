import { PrismaClient, FishRarity } from '@prisma/client';
import { generateReferralCode } from '@rare-fish/shared';

const prisma = new PrismaClient();

const FISH_SEED = [
  { symbol: 'AROWANA', name: 'Golden Arowana', rarity: FishRarity.LEGENDARY, price: 124, volatility: 0.15, trend: 0.03 },
  { symbol: 'QKOI', name: 'Quantum Koi', rarity: FishRarity.EPIC, price: 89, volatility: 0.12, trend: 0.02 },
  { symbol: 'DGUPPY', name: 'Diamond Guppy', rarity: FishRarity.RARE, price: 45, volatility: 0.18, trend: 0.01 },
  { symbol: 'EPUFFER', name: 'Emperor Puffer', rarity: FishRarity.EPIC, price: 156, volatility: 0.14, trend: -0.01 },
  { symbol: 'BDRAGON', name: 'Black Dragonfish', rarity: FishRarity.LEGENDARY, price: 210, volatility: 0.2, trend: 0.04 },
  { symbol: 'CBETTA', name: 'Cosmic Betta', rarity: FishRarity.RARE, price: 67, volatility: 0.16, trend: 0.025 },
  { symbol: 'ASHARK', name: 'Albino Shark', rarity: FishRarity.EPIC, price: 178, volatility: 0.13, trend: 0.015 },
  { symbol: 'MWHALE', name: 'Mega Whale', rarity: FishRarity.MYTHIC, price: 420, volatility: 0.22, trend: 0.05 },
  // +10 listings
  { symbol: 'NEON', name: 'Neon Tetra', rarity: FishRarity.COMMON, price: 2.4, volatility: 0.22, trend: 0.01 },
  { symbol: 'CLOWN', name: 'Anomaly Clownfish', rarity: FishRarity.RARE, price: 14.5, volatility: 0.18, trend: 0.02 },
  { symbol: 'ANGEL', name: 'Moon Angel', rarity: FishRarity.EPIC, price: 96, volatility: 0.14, trend: 0.015 },
  { symbol: 'STING', name: 'Void Stingray', rarity: FishRarity.LEGENDARY, price: 248, volatility: 0.19, trend: 0.03 },
  { symbol: 'HORSE', name: 'Pixel Seahorse', rarity: FishRarity.RARE, price: 28, volatility: 0.17, trend: 0.01 },
  { symbol: 'BARRA', name: 'Laser Barracuda', rarity: FishRarity.EPIC, price: 112, volatility: 0.16, trend: -0.01 },
  { symbol: 'GLDFSH', name: 'Glitch Goldfish', rarity: FishRarity.COMMON, price: 1.75, volatility: 0.25, trend: 0.005 },
  { symbol: 'MANTA', name: 'Deep Manta', rarity: FishRarity.MYTHIC, price: 365, volatility: 0.2, trend: 0.04 },
  { symbol: 'PIRANA', name: 'Chaos Piranha', rarity: FishRarity.EPIC, price: 74, volatility: 0.21, trend: 0.02 },
  { symbol: 'CATFSH', name: 'Abyss Catfish', rarity: FishRarity.RARE, price: 19.2, volatility: 0.15, trend: 0.008 },
];

async function main() {
  console.log('Seeding fish...');

  for (let i = 0; i < FISH_SEED.length; i++) {
    const f = FISH_SEED[i];
    await prisma.fish.upsert({
      where: { symbol: f.symbol },
      update: {},
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
        minPrice: Math.max(0.05, f.price * 0.15),
        maxPrice: f.price * 8,
        sortOrder: i,
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

  console.log(`Seeded ${FISH_SEED.length} fish and payment config.`);
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
