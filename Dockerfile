# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.13.1
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

# Install system dependencies for puppeteer (whatsapp-web.js uses puppeteer)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
        wget \
        libu2f-udev \
        libvulkan1 \
        libxshmfence1 \
        libxss1 \
        libappindicator3-1 \
        libatspi2.0-0 \
        libexpat1 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrender1 \
        libxi6 \
        libxtst6 \
        --no-install-suggests && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Copy package files and install dependencies
COPY --link package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --production

# Copy application source code
COPY --link src ./src
COPY --link models ./models
COPY --link routes ./routes
COPY --link utils ./utils
COPY --link uploads ./uploads
COPY --link logs ./logs
COPY --link app.js ./app.js

# Ensure runtime directories exist and are writable
RUN mkdir -p /app/.wwebjs_auth/session /app/.wwebjs_cache /app/uploads/products /app/logs && \
    chown -R appuser:appgroup /app

# Set environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"

USER appuser

EXPOSE 3000

CMD ["npm", "start"]

# .env and other secrets should be provided at runtime, not baked into the image.
# Make sure to add .env to your .dockerignore!
