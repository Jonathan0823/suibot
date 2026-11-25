# Stage 1: Build dependencies
FROM oven/bun:alpine AS builder
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source code (sesuai struktur)
COPY src ./src
COPY utils ./utils
COPY index.js ./

# Stage 2: Final image
FROM oven/bun:alpine AS runner
WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/package.json .
COPY --from=builder /app/bun.lock .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/index.js .

# Set non-root user
USER bun

# Start the bot
CMD ["bun", "run", "start"]