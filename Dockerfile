# Build stage. Dev dependencies are needed for tsc, so they do not survive
# into the runtime image below.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# Migration SQL ships with the image so a deploy can apply pending migrations
# against whichever database it points at.
COPY --from=build /app/drizzle ./drizzle
COPY drizzle.config.ts ./

# Winston writes here whenever NODE_ENV is not production, and compose's
# env_file can override the ENV above. Created and owned before dropping
# privileges so that path cannot crash the container on boot.
RUN mkdir -p logs && chown -R node:node /app

# Never run as root. The node image already provides this user.
USER node

EXPOSE 5050

# The indexer and SSE hub need SIGTERM to release the leader lock and close
# open streams, so PID 1 must forward signals rather than swallow them.
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5050)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
