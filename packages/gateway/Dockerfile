FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway/package.json packages/gateway/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ticlaw/gateway run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/gateway ./packages/gateway
COPY --from=build /app/node_modules ./node_modules

ENV PORT=10000
EXPOSE 10000

CMD ["node", "packages/gateway/dist/start.js"]
