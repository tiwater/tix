# Dockerfile for TiClaw with Built-in Chrome 146
# This Dockerfile provides a "clean" environment for browser automation with MCP support.
# Usage: Set runtime to 'docker' in render.yaml and reference this file.

FROM node:22-slim AS base

# 1. Install system dependencies for Chrome
# These are the shared libraries Chrome needs to run in a headless Linux environment.
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    fonts-liberation \
    libappindicator3-1 \
    libu2f-udev \
    libvulkan1 \
    xdg-utils \
    --no-install-recommends

# 2. Install Google Chrome Stable (Currently 146.x)
# Chrome 146 introduces built-in MCP (Model Context Protocol) support for AI agents.
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Build TiClaw
WORKDIR /app
COPY . .

# Install pnpm and build the project
RUN npm install -g pnpm && \
    pnpm install && \
    pnpm run build

# 4. Prepare Persistance for browser sessions
# We use /root/.ticlaw as the default TICLAW_HOME. 
# In Render, mount a Persistent Disk to this directory to keep login sessions across deploys.
RUN mkdir -p /root/.ticlaw/browser-data

# 5. Runtime Configuration
ENV NODE_ENV=production
ENV TICLAW_HOME=/root/.ticlaw
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV HTTP_PORT=10000

EXPOSE 10000

# Start TiClaw Edge with the compiled distribution
CMD ["node", "packages/node/dist/index.js"]
