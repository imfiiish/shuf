# syntax=docker/dockerfile:1

# ---- build the front end -------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts \
     index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- runtime -------------------------------------------------------------
# One process serves the JSON API, /audio and the built SPA (server/index.ts
# falls back to dist/index.html for client routes). Node 24 runs the .ts
# server directly via type stripping, so tsx is not needed here.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
# Migrations run on start-up (see server/migrate.ts).
COPY db/migrations ./db/migrations
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server/index.ts"]
