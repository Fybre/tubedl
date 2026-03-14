# ── Build stage ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ───────────────────────────────────────────
FROM node:20-alpine

# Install Python 3, pip, ffmpeg, and mutagen (needed by yt-dlp)
RUN apk add --no-cache \
      python3 \
      py3-pip \
      ffmpeg \
      py3-mutagen \
      ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && yt-dlp --version

WORKDIR /app

# Copy dependencies from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY package*.json ./
COPY server.js     ./
COPY services/     ./services/
COPY routes/       ./routes/
COPY public/       ./public/

# Create downloads directory with proper permissions
RUN mkdir -p /app/downloads

ENV NODE_ENV=production \
    PORT=3000 \
    DOWNLOAD_DIR=/app/downloads \
    MAX_CONCURRENT=2

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ | grep -q TubeDL || exit 1

CMD ["node", "server.js"]
