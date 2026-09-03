#!/usr/bin/env ts-node
/**
 * bridge-sync.ts
 *
 * One-time (but idempotent) migration script that populates the `users` bridge
 * table from the three legacy tables: clients, client_staff, buyers.
 *
 * Run with:
 *   cd Backend && npx ts-node prisma/bridge-sync.ts
 *
 * Safe to re-run: uses upsert with a no-op update body so no rows are duplicated
 * or overwritten.
 */

import { PrismaClient, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Maps a ClientStatus value to a UserStatus value.
 * ClientStatus: ACTIVE | INACTIVE | SUSPENDED | PENDING
 * UserStatus:   ACTIVE | INACTIVE | SUSPENDED | PENDING_VERIFICATION
 */
function clientStatusToUserStatus(status: string): UserStatus {
  switch (status) {
    case 'ACTIVE':
      return UserStatus.ACTIVE;
    case 'INACTIVE':
      return UserStatus.INACTIVE;
    case 'SUSPENDED':
      return UserStatus.SUSPENDED;
    case 'PENDING':
      return UserStatus.PENDING_VERIFICATION;
    default:
      return UserStatus.ACTIVE;
  }
}

async function main() {
  let created = 0;
  let skipped = 0;

  // ── clients → users ──────────────────────────────────────────────────────────
  console.log('=== Bridge Sync: clients → users ===');
  const clients = await prisma.client.findMany({ where: { deletedAt: null } });
  for (const c of clients) {
    try {
      await prisma.user.upsert({
        where: { legacyId_legacyTable: { legacyId: c.id, legacyTable: 'clients' } },
        create: {
          email: c.email,
          phone: c.phone ?? null,
          name: c.name,
          password: c.password,
          role: 'client',
          status: clientStatusToUserStatus(c.status),
          legacyId: c.id,
          legacyTable: 'clients',
          createdAt: c.createdAt,
          deletedAt: c.deletedAt,
        },
        update: {},
      });
      created++;
    } catch (err: any) {
      console.warn(`  SKIP clients:${c.id} (${c.email}): ${err.message}`);
      skipped++;
    }
  }
  console.log(`  clients: ${created} synced, ${skipped} skipped`);

  // ── client_staff → users ──────────────────────────────────────────────────────
  created = 0;
  skipped = 0;
  console.log('\n=== Bridge Sync: client_staff → users ===');
  const staff = await prisma.clientStaff.findMany({ where: { deletedAt: null } });
  for (const s of staff) {
    try {
      await prisma.user.upsert({
        where: { legacyId_legacyTable: { legacyId: s.id, legacyTable: 'client_staff' } },
        create: {
          email: s.email ?? null,
          // ClientStaff has no phone field in the schema
          phone: null,
          name: s.name ?? '',
          password: s.password ?? '',
          role: 'staff',
          status: s.isActive ? UserStatus.ACTIVE : UserStatus.SUSPENDED,
          clientId: s.clientId,
          legacyId: s.id,
          legacyTable: 'client_staff',
          createdAt: s.createdAt,
          deletedAt: s.deletedAt ?? null,
        },
        update: {},
      });
      created++;
    } catch (err: any) {
      console.warn(`  SKIP client_staff:${s.id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`  client_staff: ${created} synced, ${skipped} skipped`);

  // ── buyers → users ────────────────────────────────────────────────────────────
  created = 0;
  skipped = 0;
  console.log('\n=== Bridge Sync: buyers → users ===');
  const buyers = await prisma.buyer.findMany({ where: { deletedAt: null } });
  for (const b of buyers) {
    try {
      await prisma.user.upsert({
        where: { legacyId_legacyTable: { legacyId: b.id, legacyTable: 'buyers' } },
        create: {
          email: b.email ?? null,
          phone: b.phone ?? null,
          name: b.name,
          password: b.password ?? '',
          role: 'buyer',
          status: b.status ?? UserStatus.ACTIVE,
          clientId: b.clientId,
          legacyId: b.id,
          legacyTable: 'buyers',
          createdAt: b.createdAt,
          deletedAt: b.deletedAt ?? null,
        },
        update: {},
      });
      created++;
    } catch (err: any) {
      console.warn(`  SKIP buyers:${b.id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`  buyers: ${created} synced, ${skipped} skipped`);

  console.log('\n✅ Bridge sync complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
