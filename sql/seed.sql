-- ============================================================
-- Lottery SaaS - Seed Data
-- Run this in phpPgAdmin → edilegna database → SQL tab
-- ============================================================

-- Super Admin (skip if already exists)
INSERT INTO public.admins (id, email, password, name, role, status, "failedLoginCount", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'admin@lottery.com',
  '$argon2id$v=19$m=65536,p=4,t=3$0JaELV43dQKTtjdbg2VCOA$gg8aU6ZM/4yanv69OlvNThsDGiPSJkF5lqCuoRLainc',
  'Super Admin',
  'admin',
  'ACTIVE',
  0,
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;

-- Subscription Plans (skip if already exist)
INSERT INTO public.plans (
  id, name, slug, description,
  "monthlyPrice", "yearlyPrice",
  "maxLotteriesPerCycle", "maxActiveLotteries", "maxTicketsPerLottery",
  "minTicketPrice", "maxTicketPrice",
  "storageQuotaGb", "lotteryTypesAllowed",
  "hasReporting", "hasApiAccess", "supportLevel",
  "isActive", "sortOrder", "createdAt", "updatedAt"
)
VALUES
(
  gen_random_uuid()::text, 'Starter', 'starter', 'Perfect for getting started',
  0, 0, 3, 1, 500, 10, 1000, 1,
  ARRAY['STANDARD']::"LotteryType"[],
  true, false, 'basic', true, 0, NOW(), NOW()
),
(
  gen_random_uuid()::text, 'Pro', 'pro', 'For growing operators',
  299, 2990, 20, 5, 5000, 5, 10000, 10,
  ARRAY['STANDARD','RAFFLE']::"LotteryType"[],
  true, false, 'priority', true, 1, NOW(), NOW()
),
(
  gen_random_uuid()::text, 'Enterprise', 'enterprise', 'Unlimited scale',
  999, 9990, 100, 20, 50000, 1, 100000, 100,
  ARRAY['STANDARD','RAFFLE','INSTANT_WIN','SCRATCH_CARD']::"LotteryType"[],
  true, true, 'dedicated', true, 2, NOW(), NOW()
)
ON CONFLICT (slug) DO NOTHING;

-- Demo Client / Operator (skip if already exists)
INSERT INTO public.clients (
  id, email, password, name, "businessName", username,
  phone, city, status,
  "isVerified", "verifiedAt",
  "failedLoginCount",
  "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'operator@demo.com',
  '$argon2id$v=19$m=65536,p=4,t=3$WYctyPgunypsafWJYvIB5A$FSxp5sniW63WpddZdb7LYDk9C0cjf8AijSdd+5n7vtM',
  'Demo Operator',
  'Demo Lottery Co.',
  'demolottery',
  '+251912345678',
  'Addis Ababa',
  'ACTIVE',
  true,
  NOW(),
  0,
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;
