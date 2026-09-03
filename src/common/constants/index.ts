export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  CLIENT: 'client',
  BUYER: 'buyer',
  STAFF: 'staff',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = {
  // Admin permissions
  MANAGE_CLIENTS: 'manage:clients',
  MANAGE_PLANS: 'manage:plans',
  MANAGE_SUBSCRIPTIONS: 'manage:subscriptions',
  VIEW_PLATFORM_REPORTS: 'view:platform_reports',
  MANAGE_SETTINGS: 'manage:settings',
  VIEW_AUDIT_LOGS: 'view:audit_logs',
  MANAGE_NOTIFICATIONS: 'manage:notifications',

  // Client permissions
  MANAGE_LOTTERIES: 'manage:lotteries',
  MANAGE_TICKETS: 'manage:tickets',
  MANAGE_BUYERS: 'manage:buyers',
  VERIFY_PAYMENTS: 'verify:payments',
  DRAW_WINNERS: 'draw:winners',
  EXPORT_REPORTS: 'export:reports',
  VIEW_CLIENT_REPORTS: 'view:client_reports',

  // Buyer permissions
  PURCHASE_TICKETS: 'purchase:tickets',
  VIEW_TICKETS: 'view:tickets',
  UPLOAD_PAYMENT: 'upload:payment',
} as const;

export const QUEUE_NAMES = {
  TICKET_RESERVATION: 'ticket-reservation',
  SUBSCRIPTION_EXPIRY: 'subscription-expiry',
  EMAIL: 'email',
  SMS: 'sms',
  NOTIFICATION: 'notification',
  WINNER_ANNOUNCEMENT: 'winner-announcement',
  REPORT_GENERATION: 'report-generation',
  EXPORT: 'export',
  DATABASE_CLEANUP: 'database-cleanup',
  AUDIT_ARCHIVAL: 'audit-archival',
} as const;

export const CACHE_KEYS = {
  PLANS: 'plans:all',
  PLAN: (id: string) => `plan:${id}`,
  LOTTERY: (id: string) => `lottery:${id}`,
  LOTTERY_PUBLIC: (slug: string) => `lottery:public:${slug}`,
  CLIENT_SUBSCRIPTION: (clientId: string) => `subscription:active:${clientId}`,
  SETTINGS: 'settings:all',
} as const;

export const CACHE_TTL = {
  SHORT: 60,        // 1 minute
  MEDIUM: 300,      // 5 minutes
  LONG: 3600,       // 1 hour
  DAY: 86400,       // 24 hours
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const FILE_LIMITS = {
  PAYMENT_SLIP_MAX_SIZE: 5 * 1024 * 1024,  // 5MB
  AVATAR_MAX_SIZE: 2 * 1024 * 1024,         // 2MB
  BANNER_MAX_SIZE: 10 * 1024 * 1024,        // 10MB
  ALLOWED_SLIP_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export const TICKET_RESERVATION_TIMEOUT_MINUTES = 15;
export const MAX_TICKETS_PER_PURCHASE = 50;
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const ACCOUNT_LOCKOUT_MINUTES = 30;
