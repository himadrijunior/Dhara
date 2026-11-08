# ── Dhara — production image (multi-stage, standalone Next.js) ──
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN groupadd -r dhara && useradd -r -g dhara dhara

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public

RUN mkdir -p /app/.dhara /app/storage-uploads && chown -R dhara:dhara /app/.dhara /app/storage-uploads
USER dhara

EXPOSE 3000
VOLUME ["/app/.dhara", "/app/storage-uploads"]

CMD ["node", "server.js"]
