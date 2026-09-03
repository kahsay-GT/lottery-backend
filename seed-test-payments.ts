import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find existing client and lottery
  const client = await prisma.client.findFirst({ where: { status: 'ACTIVE' } });
  if (!client) throw new Error('No active client found');

  const lottery = await prisma.lottery.findFirst({
    where: { clientId: client.id, status: { in: ['PUBLISHED', 'SELLING', 'DRAFT'] } },
  });
  if (!lottery) throw new Error('No lottery found for client');

  console.log(`Seeding test payments for client: ${client.businessName}, lottery: ${lottery.name}`);

  const testBuyers = [
    { name: 'Abebe Bekele',      phone: '+251911000001', email: null },
    { name: 'Tigist Haile',      phone: '+251911000002', email: 'tigist@test.com' },
    { name: 'Dawit Mekonnen',    phone: '+251911000003', email: null },
    { name: 'Selam Tesfaye',     phone: '+251911000004', email: 'selam@test.com' },
    { name: 'Yonas Girma',       phone: '+251911000005', email: null },
    { name: 'Hiwot Alemu',       phone: '+251911000006', email: null },
    { name: 'Bereket Tadesse',   phone: '+251911000007', email: 'bereket@test.com' },
    { name: 'Meron Habtamu',     phone: '+251911000008', email: null },
    { name: 'Fitsum Getachew',   phone: '+251911000009', email: null },
  ];

  const statuses: ('SUBMITTED' | 'UNDER_REVIEW')[] = [
    'SUBMITTED', 'UNDER_REVIEW', 'SUBMITTED', 'SUBMITTED',
    'UNDER_REVIEW', 'SUBMITTED', 'UNDER_REVIEW', 'SUBMITTED', 'SUBMITTED',
  ];

  const amounts = [300, 600, 1200, 300, 600, 900, 600, 300, 1500];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const randRef = () => Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  for (let i = 0; i < testBuyers.length; i++) {
    const b = testBuyers[i];

    // Upsert buyer
    let buyer = await prisma.buyer.findFirst({
      where: { clientId: client.id, phone: b.phone },
    });
    if (!buyer) {
      buyer = await prisma.buyer.create({
        data: {
          clientId: client.id,
          name: b.name,
          phone: b.phone,
          email: b.email ?? null,
          isGuest: true,
          status: 'ACTIVE',
        },
      });
    }

    // Create payment
    const payment = await prisma.paymentTransaction.create({
      data: {
        clientId: client.id,
        lotteryId: lottery.id,
        buyerId: buyer.id,
        amount: amounts[i],
        currency: 'ETB',
        status: statuses[i],
        provider: 'MANUAL_BANK_TRANSFER',
        referenceCode: randRef(),
      },
    });

    console.log(`  Created: ${payment.referenceCode} | ${b.name} | ${b.phone} | ${amounts[i]} ETB | ${statuses[i]}`);
  }

  console.log('\nDone! 9 test payments created.');
  console.log('Total pending payments now:',
    await prisma.paymentTransaction.count({
      where: { clientId: client.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, deletedAt: null },
    })
  );
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
