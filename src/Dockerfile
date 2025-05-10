# syntax=docker/dockerfile:1

# ---- Base Node image ----
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install dependencies only, using package.json and package-lock.json if present
COPY --link package*.json ./
RUN npm ci --omit=dev

# ---- Build/Production image ----
FROM node:20-alpine AS final

# Create non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy node_modules from base image
COPY --from=base /app/node_modules ./node_modules

# Copy application source code (excluding .env and secrets)
COPY --link . ./

# Ensure .env and secrets are not copied (should be in .dockerignore)

# Set correct permissions
RUN chown -R appuser:appgroup /app

USER appuser

# Expose the port (default 3000, can be overridden by env)
EXPOSE 3000

# Set environment variables (can be overridden at runtime)
ENV NODE_ENV=production

# Start the application
CMD ["node", "app.js"]
