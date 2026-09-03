FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ── deps stage ──────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ── builder stage ───────────────────────────────
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ── runner stage ────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

# Non-root user
RUN addgroup -S lottery && adduser -S lottery -G lottery

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

USER lottery
EXPOSE 3000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
