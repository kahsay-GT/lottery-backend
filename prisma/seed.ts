import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // ── Admin ──────────────────────────────────────────────────────
  const existingAdmin = await prisma.admin.findFirst({ where: { email: 'admin@lottery.com' } });
  if (!existingAdmin) {
    const hashed = await argon2.hash('Admin@123456');
    await prisma.admin.create({
      data: {
        email: 'admin@lottery.com',
        password: hashed,
        name: 'Super Admin',
        role: 'admin',
        status: 'ACTIVE',
      },
    });
    console.log('✅ Admin created: admin@lottery.com / Admin@123456');
  } else {
    console.log('ℹ️  Admin already exists:', existingAdmin.email);
  }

  // ── Plans ─────────────────────────────────────────────────────
  const planExists = await prisma.plan.findFirst({ where: { slug: 'starter' } });
  if (!planExists) {
    await prisma.plan.createMany({
      data: [
        {
          name: 'Starter',
          slug: 'starter',
          description: 'Perfect for getting started',
          monthlyPrice: 0,
          yearlyPrice: 0,
          maxLotteriesPerCycle: 3,
          maxActiveLotteries: 1,
          maxTicketsPerLottery: 500,
          minTicketPrice: 10,
          maxTicketPrice: 1000,
          storageQuotaGb: 1,
          lotteryTypesAllowed: ['STANDARD'],
          isActive: true,
          sortOrder: 0,
        },
        {
          name: 'Pro',
          slug: 'pro',
          description: 'For growing operators',
          monthlyPrice: 299,
          yearlyPrice: 2990,
          maxLotteriesPerCycle: 20,
          maxActiveLotteries: 5,
          maxTicketsPerLottery: 5000,
          minTicketPrice: 5,
          maxTicketPrice: 10000,
          storageQuotaGb: 10,
          lotteryTypesAllowed: ['STANDARD', 'RAFFLE'],
          isActive: true,
          sortOrder: 1,
        },
        {
          name: 'Enterprise',
          slug: 'enterprise',
          description: 'Unlimited scale',
          monthlyPrice: 999,
          yearlyPrice: 9990,
          maxLotteriesPerCycle: 100,
          maxActiveLotteries: 20,
          maxTicketsPerLottery: 50000,
          minTicketPrice: 1,
          maxTicketPrice: 100000,
          storageQuotaGb: 100,
          lotteryTypesAllowed: ['STANDARD', 'RAFFLE', 'INSTANT_WIN', 'SCRATCH_CARD'],
          isActive: true,
          sortOrder: 2,
        },
      ],
    });
    console.log('✅ Plans created');
  } else {
    console.log('ℹ️  Plans already exist');
  }

  // ── Test Client (Operator) ────────────────────────────────────
  const clientExists = await prisma.client.findFirst({ where: { email: 'operator@demo.com' } });
  if (!clientExists) {
    const hashed = await argon2.hash('Operator@123456');
    await prisma.client.create({
      data: {
        email: 'operator@demo.com',
        password: hashed,
        name: 'Demo Operator',
        businessName: 'Demo Lottery Co.',
        username: 'demolottery',
        phone: '+251912345678',
        city: 'Addis Ababa',
        status: 'ACTIVE',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
    console.log('✅ Demo client created: operator@demo.com / Operator@123456');
  } else {
    console.log('ℹ️  Demo client already exists');
  }

  console.log('\n🎉 Seed complete');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
