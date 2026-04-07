FROM node:22-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

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

RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/computer/package.json packages/computer/package.json
COPY packages/gateway/package.json packages/gateway/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM base AS runtime
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/computer ./packages/computer
COPY --from=build /app/packages/gateway ./packages/gateway
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/skills ./skills
COPY --from=build /app/config.example.yaml ./config.example.yaml
COPY --from=build /app/CLAUDE.md ./CLAUDE.md

RUN mkdir -p /root/.tix/browser-data

ENV NODE_ENV=production
ENV TIX_HOME=/root/.tix
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PORT=10000
ENV HTTP_PORT=10000

EXPOSE 10000

CMD ["node", "packages/computer/dist/index.js"]
