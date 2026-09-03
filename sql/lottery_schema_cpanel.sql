--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO edilegnalottery;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: AuditAction; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AuditAction" AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'APPROVE',
    'REJECT',
    'SUSPEND',
    'ACTIVATE',
    'DRAW',
    'ASSIGN',
    'EXPORT',
    'UPLOAD',
    'DOWNLOAD'
);


ALTER TYPE public."AuditAction" OWNER TO edilegnalottery;

--
-- Name: BillingCycle; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."BillingCycle" AS ENUM (
    'MONTHLY',
    'YEARLY'
);


ALTER TYPE public."BillingCycle" OWNER TO edilegnalottery;

--
-- Name: ClientStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ClientStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED',
    'PENDING'
);


ALTER TYPE public."ClientStatus" OWNER TO edilegnalottery;

--
-- Name: DrawMethod; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."DrawMethod" AS ENUM (
    'RANDOM_SYSTEM',
    'MANUAL',
    'THIRD_PARTY'
);


ALTER TYPE public."DrawMethod" OWNER TO edilegnalottery;

--
-- Name: ExportFormat; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ExportFormat" AS ENUM (
    'EXCEL',
    'CSV',
    'PDF'
);


ALTER TYPE public."ExportFormat" OWNER TO edilegnalottery;

--
-- Name: ExportStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ExportStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED'
);


ALTER TYPE public."ExportStatus" OWNER TO edilegnalottery;

--
-- Name: LotteryStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."LotteryStatus" AS ENUM (
    'DRAFT',
    'PUBLISHED',
    'SELLING',
    'CLOSED',
    'DRAWING',
    'COMPLETED',
    'ARCHIVED'
);


ALTER TYPE public."LotteryStatus" OWNER TO edilegnalottery;

--
-- Name: LotteryType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."LotteryType" AS ENUM (
    'STANDARD',
    'RAFFLE',
    'SCRATCH_CARD',
    'INSTANT_WIN'
);


ALTER TYPE public."LotteryType" OWNER TO edilegnalottery;

--
-- Name: LotteryVisibility; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."LotteryVisibility" AS ENUM (
    'PUBLIC',
    'PRIVATE',
    'UNLISTED'
);


ALTER TYPE public."LotteryVisibility" OWNER TO edilegnalottery;

--
-- Name: NotificationChannel; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."NotificationChannel" AS ENUM (
    'EMAIL',
    'SMS',
    'WHATSAPP',
    'PUSH',
    'IN_APP',
    'WEBSOCKET'
);


ALTER TYPE public."NotificationChannel" OWNER TO edilegnalottery;

--
-- Name: NotificationStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."NotificationStatus" AS ENUM (
    'PENDING',
    'SENT',
    'FAILED',
    'READ'
);


ALTER TYPE public."NotificationStatus" OWNER TO edilegnalottery;

--
-- Name: PaymentProvider; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentProvider" AS ENUM (
    'MANUAL_BANK_TRANSFER',
    'STRIPE',
    'PAYPAL',
    'FLUTTERWAVE',
    'CHAPA',
    'TELEBIRR'
);


ALTER TYPE public."PaymentProvider" OWNER TO edilegnalottery;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'INITIATED',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'REFUNDED'
);


ALTER TYPE public."PaymentStatus" OWNER TO edilegnalottery;

--
-- Name: PrizeStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PrizeStatus" AS ENUM (
    'ACTIVE',
    'CLAIMED',
    'UNCLAIMED',
    'VOID'
);


ALTER TYPE public."PrizeStatus" OWNER TO edilegnalottery;

--
-- Name: StaffRole; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."StaffRole" AS ENUM (
    'APPROVER',
    'VIEWER'
);


ALTER TYPE public."StaffRole" OWNER TO edilegnalottery;

--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'PENDING',
    'AWAITING_PAYMENT',
    'UNDER_REVIEW',
    'ACTIVE',
    'EXPIRED',
    'CANCELLED'
);


ALTER TYPE public."SubscriptionStatus" OWNER TO edilegnalottery;

--
-- Name: TicketStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."TicketStatus" AS ENUM (
    'AVAILABLE',
    'RESERVED',
    'PENDING_PAYMENT',
    'SOLD',
    'CANCELLED'
);


ALTER TYPE public."TicketStatus" OWNER TO edilegnalottery;

--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."UserRole" AS ENUM (
    'client',
    'buyer',
    'staff',
    'super_admin'
);


ALTER TYPE public."UserRole" OWNER TO edilegnalottery;

--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED',
    'PENDING_VERIFICATION'
);


ALTER TYPE public."UserStatus" OWNER TO edilegnalottery;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admins (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    name text NOT NULL,
    phone text,
    avatar text,
    role text DEFAULT 'admin'::text NOT NULL,
    status public."UserStatus" DEFAULT 'PENDING_VERIFICATION'::public."UserStatus" NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "phoneVerifiedAt" timestamp(3) without time zone,
    "lastLoginAt" timestamp(3) without time zone,
    "lastLoginIp" text,
    "failedLoginCount" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.admins OWNER TO edilegnalottery;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.api_keys (
    id text NOT NULL,
    "clientId" text NOT NULL,
    name text NOT NULL,
    "keyHash" text NOT NULL,
    permissions text[],
    "expiresAt" timestamp(3) without time zone,
    "lastUsedAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.api_keys OWNER TO edilegnalottery;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    "adminId" text,
    "clientId" text,
    "entityType" text NOT NULL,
    "entityId" text NOT NULL,
    action public."AuditAction" NOT NULL,
    "oldValue" jsonb,
    "newValue" jsonb,
    "ipAddress" text,
    "userAgent" text,
    device text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO edilegnalottery;

--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bank_accounts (
    id text NOT NULL,
    "clientId" text,
    "bankId" text NOT NULL,
    "accountName" text NOT NULL,
    "accountNumber" text NOT NULL,
    "branchName" text,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.bank_accounts OWNER TO edilegnalottery;

--
-- Name: banks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.banks (
    id text NOT NULL,
    name text NOT NULL,
    code text,
    "countryId" text,
    "isActive" boolean DEFAULT true NOT NULL
);


ALTER TABLE public.banks OWNER TO edilegnalottery;

--
-- Name: buyers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.buyers (
    id text NOT NULL,
    "clientId" text NOT NULL,
    email text,
    name text NOT NULL,
    phone text,
    password text,
    "isGuest" boolean DEFAULT false NOT NULL,
    "guestToken" text,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "lastLoginAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.buyers OWNER TO edilegnalottery;

--
-- Name: client_staff; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.client_staff (
    id text NOT NULL,
    "clientId" text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role public."StaffRole" DEFAULT 'VIEWER'::public."StaffRole" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.client_staff OWNER TO edilegnalottery;

--
-- Name: clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clients (
    id text NOT NULL,
    email text NOT NULL,
    username text,
    password text NOT NULL,
    name text NOT NULL,
    "businessName" text NOT NULL,
    phone text,
    logo text,
    website text,
    address text,
    city text,
    "countryId" text,
    "isVerified" boolean DEFAULT false NOT NULL,
    "verifiedAt" timestamp(3) without time zone,
    status public."ClientStatus" DEFAULT 'PENDING'::public."ClientStatus" NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "phoneVerifiedAt" timestamp(3) without time zone,
    "lastLoginAt" timestamp(3) without time zone,
    "lastLoginIp" text,
    "failedLoginCount" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.clients OWNER TO edilegnalottery;

--
-- Name: countries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.countries (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    "dialCode" text,
    "isActive" boolean DEFAULT true NOT NULL
);


ALTER TABLE public.countries OWNER TO edilegnalottery;

--
-- Name: currencies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.currencies (
    id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    symbol text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);


ALTER TABLE public.currencies OWNER TO edilegnalottery;

--
-- Name: exports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exports (
    id text NOT NULL,
    "clientId" text,
    "lotteryId" text,
    type text NOT NULL,
    format public."ExportFormat" NOT NULL,
    status public."ExportStatus" DEFAULT 'PENDING'::public."ExportStatus" NOT NULL,
    filters jsonb,
    "fileId" text,
    "requestedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    error text
);


ALTER TABLE public.exports OWNER TO edilegnalottery;

--
-- Name: files; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.files (
    id text NOT NULL,
    "originalName" text NOT NULL,
    "storedName" text NOT NULL,
    "mimeType" text NOT NULL,
    "sizeBytes" integer NOT NULL,
    bucket text NOT NULL,
    path text NOT NULL,
    url text,
    "contentHash" text,
    "uploadedById" text,
    "uploadedByType" text,
    "isScanned" boolean DEFAULT false NOT NULL,
    "isSafe" boolean,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.files OWNER TO edilegnalottery;

--
-- Name: lotteries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lotteries (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "subscriptionId" text,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    type public."LotteryType" DEFAULT 'STANDARD'::public."LotteryType" NOT NULL,
    banner text,
    "ticketPrice" numeric(10,2) NOT NULL,
    "totalTickets" integer NOT NULL,
    "ticketStart" integer DEFAULT 1 NOT NULL,
    "ticketEnd" integer,
    "ticketsSold" integer DEFAULT 0 NOT NULL,
    "saleStartDate" timestamp(3) without time zone NOT NULL,
    "saleEndDate" timestamp(3) without time zone NOT NULL,
    "drawDate" timestamp(3) without time zone NOT NULL,
    status public."LotteryStatus" DEFAULT 'DRAFT'::public."LotteryStatus" NOT NULL,
    visibility public."LotteryVisibility" DEFAULT 'PUBLIC'::public."LotteryVisibility" NOT NULL,
    "termsConditions" text,
    "drawHash" text,
    "drawSeed" text,
    "drawnAt" timestamp(3) without time zone,
    "publishedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.lotteries OWNER TO edilegnalottery;

--
-- Name: lottery_draws; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lottery_draws (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    "drawMethod" public."DrawMethod" DEFAULT 'RANDOM_SYSTEM'::public."DrawMethod" NOT NULL,
    seed text NOT NULL,
    hash text NOT NULL,
    algorithm text DEFAULT 'SHA256_MERSENNE_TWISTER'::text NOT NULL,
    "drawnAt" timestamp(3) without time zone NOT NULL,
    "drawnById" text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.lottery_draws OWNER TO edilegnalottery;

--
-- Name: lottery_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lottery_images (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    "fileId" text NOT NULL,
    url text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.lottery_images OWNER TO edilegnalottery;

--
-- Name: lottery_prizes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lottery_prizes (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    rank integer NOT NULL,
    title text NOT NULL,
    description text,
    "prizeValue" numeric(12,2) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    status public."PrizeStatus" DEFAULT 'ACTIVE'::public."PrizeStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.lottery_prizes OWNER TO edilegnalottery;

--
-- Name: lottery_tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lottery_tickets (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    "clientId" text NOT NULL,
    "buyerId" text,
    "ticketNumber" text NOT NULL,
    status public."TicketStatus" DEFAULT 'AVAILABLE'::public."TicketStatus" NOT NULL,
    "purchasedAt" timestamp(3) without time zone,
    "assignedAt" timestamp(3) without time zone,
    "paymentId" text,
    "reservationId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.lottery_tickets OWNER TO edilegnalottery;

--
-- Name: lottery_winners; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lottery_winners (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    "drawId" text NOT NULL,
    "prizeId" text NOT NULL,
    "ticketId" text NOT NULL,
    "buyerId" text,
    "guestName" text,
    "guestEmail" text,
    "publishedAt" timestamp(3) without time zone,
    "claimedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.lottery_winners OWNER TO edilegnalottery;

--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_templates (
    id text NOT NULL,
    name text NOT NULL,
    channel public."NotificationChannel" NOT NULL,
    subject text,
    body text NOT NULL,
    variables text[],
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.notification_templates OWNER TO edilegnalottery;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    "clientId" text,
    "buyerId" text,
    "templateId" text,
    channel public."NotificationChannel" NOT NULL,
    recipient text NOT NULL,
    subject text,
    body text NOT NULL,
    status public."NotificationStatus" DEFAULT 'PENDING'::public."NotificationStatus" NOT NULL,
    "sentAt" timestamp(3) without time zone,
    "readAt" timestamp(3) without time zone,
    "failureReason" text,
    "retryCount" integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.notifications OWNER TO edilegnalottery;

--
-- Name: payment_slips; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_slips (
    id text NOT NULL,
    "paymentTransactionId" text,
    "subscriptionTransactionId" text,
    "fileId" text NOT NULL,
    "receiptUrl" text,
    "uploadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.payment_slips OWNER TO edilegnalottery;

--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_transactions (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "lotteryId" text,
    "buyerId" text,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'ETB'::text NOT NULL,
    status public."PaymentStatus" DEFAULT 'INITIATED'::public."PaymentStatus" NOT NULL,
    provider public."PaymentProvider" DEFAULT 'MANUAL_BANK_TRANSFER'::public."PaymentProvider" NOT NULL,
    "referenceCode" text NOT NULL,
    "idempotencyKey" text,
    "rejectionReason" text,
    "reviewedById" text,
    "reviewedAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone,
    "approvedByStaffId" text,
    "rejectedByStaffId" text,
    "refundedAt" timestamp(3) without time zone,
    "refundReason" text,
    notes text,
    metadata jsonb,
    "deletedAt" timestamp(3) without time zone,
    "deleteReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.payment_transactions OWNER TO edilegnalottery;

--
-- Name: plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plans (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    "monthlyPrice" numeric(10,2) NOT NULL,
    "yearlyPrice" numeric(10,2) NOT NULL,
    "maxLotteriesPerCycle" integer NOT NULL,
    "maxActiveLotteries" integer NOT NULL,
    "maxTicketsPerLottery" integer NOT NULL,
    "minTicketPrice" numeric(10,2) NOT NULL,
    "maxTicketPrice" numeric(10,2) NOT NULL,
    "storageQuotaGb" integer NOT NULL,
    "lotteryTypesAllowed" public."LotteryType"[],
    "hasReporting" boolean DEFAULT true NOT NULL,
    "hasApiAccess" boolean DEFAULT false NOT NULL,
    "supportLevel" text DEFAULT 'basic'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.plans OWNER TO edilegnalottery;

--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    id text NOT NULL,
    token text NOT NULL,
    "adminId" text,
    "clientId" text,
    "buyerId" text,
    "staffId" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO edilegnalottery;

--
-- Name: reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reports (
    id text NOT NULL,
    "clientId" text,
    "lotteryId" text,
    type text NOT NULL,
    filters jsonb,
    data jsonb,
    "generatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.reports OWNER TO edilegnalottery;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    "adminId" text,
    "clientId" text,
    "ipAddress" text,
    "userAgent" text,
    "lastActive" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.sessions OWNER TO edilegnalottery;

--
-- Name: settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings (
    id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    "group" text DEFAULT 'general'::text NOT NULL,
    "isPublic" boolean DEFAULT false NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.settings OWNER TO edilegnalottery;

--
-- Name: subscription_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_transactions (
    id text NOT NULL,
    "subscriptionId" text NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'ETB'::text NOT NULL,
    status public."PaymentStatus" DEFAULT 'INITIATED'::public."PaymentStatus" NOT NULL,
    provider public."PaymentProvider" DEFAULT 'MANUAL_BANK_TRANSFER'::public."PaymentProvider" NOT NULL,
    "referenceCode" text NOT NULL,
    notes text,
    metadata jsonb,
    "paidAt" timestamp(3) without time zone,
    "approvedAt" timestamp(3) without time zone,
    "rejectionReason" text,
    "reviewedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.subscription_transactions OWNER TO edilegnalottery;

--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "planId" text NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'PENDING'::public."SubscriptionStatus" NOT NULL,
    "billingCycle" public."BillingCycle" NOT NULL,
    price numeric(10,2) NOT NULL,
    "startsAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "cancelledAt" timestamp(3) without time zone,
    "lotteriesUsed" integer DEFAULT 0 NOT NULL,
    "storageUsedGb" numeric(10,4) DEFAULT 0 NOT NULL,
    "autoRenew" boolean DEFAULT true NOT NULL,
    notes text,
    "approvedById" text,
    "approvedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.subscriptions OWNER TO edilegnalottery;

--
-- Name: ticket_reservations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_reservations (
    id text NOT NULL,
    "lotteryId" text NOT NULL,
    "clientId" text NOT NULL,
    "buyerEmail" text,
    "buyerName" text NOT NULL,
    "buyerPhone" text,
    quantity integer NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "confirmedAt" timestamp(3) without time zone,
    "cancelledAt" timestamp(3) without time zone,
    "idempotencyKey" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.ticket_reservations OWNER TO edilegnalottery;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text,
    phone text,
    name text NOT NULL,
    password text NOT NULL,
    role public."UserRole" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "clientId" text,
    "legacyId" text NOT NULL,
    "legacyTable" text NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "failedLoginCount" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public.users OWNER TO edilegnalottery;

--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webhook_events (
    id text NOT NULL,
    "clientId" text,
    "eventType" text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "lastError" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.webhook_events OWNER TO edilegnalottery;

--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- Name: buyers buyers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_pkey PRIMARY KEY (id);


--
-- Name: client_staff client_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.client_staff
    ADD CONSTRAINT client_staff_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (id);


--
-- Name: exports exports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: lotteries lotteries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotteries
    ADD CONSTRAINT lotteries_pkey PRIMARY KEY (id);


--
-- Name: lottery_draws lottery_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_draws
    ADD CONSTRAINT lottery_draws_pkey PRIMARY KEY (id);


--
-- Name: lottery_images lottery_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_images
    ADD CONSTRAINT lottery_images_pkey PRIMARY KEY (id);


--
-- Name: lottery_prizes lottery_prizes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_prizes
    ADD CONSTRAINT lottery_prizes_pkey PRIMARY KEY (id);


--
-- Name: lottery_tickets lottery_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_tickets
    ADD CONSTRAINT lottery_tickets_pkey PRIMARY KEY (id);


--
-- Name: lottery_winners lottery_winners_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_winners
    ADD CONSTRAINT lottery_winners_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_slips payment_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT payment_slips_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: subscription_transactions subscription_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_transactions
    ADD CONSTRAINT subscription_transactions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: ticket_reservations ticket_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_reservations
    ADD CONSTRAINT ticket_reservations_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: admins_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX admins_email_key ON public.admins USING btree (email);


--
-- Name: api_keys_keyHash_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON public.api_keys USING btree ("keyHash");


--
-- Name: buyers_clientId_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "buyers_clientId_email_key" ON public.buyers USING btree ("clientId", email);


--
-- Name: buyers_guestToken_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "buyers_guestToken_key" ON public.buyers USING btree ("guestToken");


--
-- Name: client_staff_clientId_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "client_staff_clientId_email_key" ON public.client_staff USING btree ("clientId", email);


--
-- Name: clients_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX clients_email_key ON public.clients USING btree (email);


--
-- Name: clients_username_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX clients_username_key ON public.clients USING btree (username);


--
-- Name: countries_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX countries_code_key ON public.countries USING btree (code);


--
-- Name: currencies_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX currencies_code_key ON public.currencies USING btree (code);


--
-- Name: lotteries_clientId_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "lotteries_clientId_slug_key" ON public.lotteries USING btree ("clientId", slug);


--
-- Name: lottery_tickets_lotteryId_ticketNumber_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "lottery_tickets_lotteryId_ticketNumber_key" ON public.lottery_tickets USING btree ("lotteryId", "ticketNumber");


--
-- Name: lottery_winners_ticketId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "lottery_winners_ticketId_key" ON public.lottery_winners USING btree ("ticketId");


--
-- Name: notification_templates_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX notification_templates_name_key ON public.notification_templates USING btree (name);


--
-- Name: payment_transactions_idempotencyKey_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "payment_transactions_idempotencyKey_key" ON public.payment_transactions USING btree ("idempotencyKey");


--
-- Name: payment_transactions_referenceCode_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "payment_transactions_referenceCode_key" ON public.payment_transactions USING btree ("referenceCode");


--
-- Name: plans_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX plans_slug_key ON public.plans USING btree (slug);


--
-- Name: refresh_tokens_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX refresh_tokens_token_key ON public.refresh_tokens USING btree (token);


--
-- Name: settings_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX settings_key_key ON public.settings USING btree (key);


--
-- Name: subscription_transactions_referenceCode_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "subscription_transactions_referenceCode_key" ON public.subscription_transactions USING btree ("referenceCode");


--
-- Name: ticket_reservations_idempotencyKey_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ticket_reservations_idempotencyKey_key" ON public.ticket_reservations USING btree ("idempotencyKey");


--
-- Name: users_legacyId_legacyTable_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "users_legacyId_legacyTable_key" ON public.users USING btree ("legacyId", "legacyTable");


--
-- Name: api_keys api_keys_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT "api_keys_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: audit_logs audit_logs_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_accounts bank_accounts_bankId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT "bank_accounts_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES public.banks(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: bank_accounts bank_accounts_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT "bank_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: banks banks_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT "banks_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public.countries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: buyers buyers_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT "buyers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_staff client_staff_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.client_staff
    ADD CONSTRAINT "client_staff_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: clients clients_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public.countries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: exports exports_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT "exports_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: lotteries lotteries_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lotteries
    ADD CONSTRAINT "lotteries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_draws lottery_draws_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_draws
    ADD CONSTRAINT "lottery_draws_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_images lottery_images_fileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_images
    ADD CONSTRAINT "lottery_images_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES public.files(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_images lottery_images_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_images
    ADD CONSTRAINT "lottery_images_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: lottery_prizes lottery_prizes_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_prizes
    ADD CONSTRAINT "lottery_prizes_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: lottery_tickets lottery_tickets_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_tickets
    ADD CONSTRAINT "lottery_tickets_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public.buyers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: lottery_tickets lottery_tickets_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_tickets
    ADD CONSTRAINT "lottery_tickets_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_tickets lottery_tickets_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_tickets
    ADD CONSTRAINT "lottery_tickets_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public.payment_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: lottery_tickets lottery_tickets_reservationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_tickets
    ADD CONSTRAINT "lottery_tickets_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES public.ticket_reservations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: lottery_winners lottery_winners_drawId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_winners
    ADD CONSTRAINT "lottery_winners_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES public.lottery_draws(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_winners lottery_winners_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_winners
    ADD CONSTRAINT "lottery_winners_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_winners lottery_winners_prizeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_winners
    ADD CONSTRAINT "lottery_winners_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES public.lottery_prizes(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lottery_winners lottery_winners_ticketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lottery_winners
    ADD CONSTRAINT "lottery_winners_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public.lottery_tickets(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: notifications notifications_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "notifications_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public.buyers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications notifications_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "notifications_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications notifications_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "notifications_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public.notification_templates(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_slips payment_slips_fileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT "payment_slips_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES public.files(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_slips payment_slips_paymentTransactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT "payment_slips_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES public.payment_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_slips payment_slips_subscriptionTransactionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT "payment_slips_subscriptionTransactionId_fkey" FOREIGN KEY ("subscriptionTransactionId") REFERENCES public.subscription_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_approvedByStaffId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT "payment_transactions_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES public.client_staff(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT "payment_transactions_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public.buyers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT "payment_transactions_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_rejectedByStaffId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT "payment_transactions_rejectedByStaffId_fkey" FOREIGN KEY ("rejectedByStaffId") REFERENCES public.client_staff(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "refresh_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_buyerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "refresh_tokens_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES public.buyers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "refresh_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_staffId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "refresh_tokens_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES public.client_staff(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: reports reports_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT "reports_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public.admins(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: subscription_transactions subscription_transactions_subscriptionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_transactions
    ADD CONSTRAINT "subscription_transactions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: subscriptions subscriptions_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: subscriptions subscriptions_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ticket_reservations ticket_reservations_lotteryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_reservations
    ADD CONSTRAINT "ticket_reservations_lotteryId_fkey" FOREIGN KEY ("lotteryId") REFERENCES public.lotteries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: users users_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: webhook_events webhook_events_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT "webhook_events_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--



--
-- PostgreSQL database dump complete
--


