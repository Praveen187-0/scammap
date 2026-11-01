# ---- build stage: compile the server and the client ----
FROM node:22-alpine AS build
WORKDIR /app
# Map settings are baked into the app at build time. Render passes environment variables as build args.
ARG VITE_MAPTILER_KEY=""
ARG VITE_TILE_URL=""
ENV VITE_MAPTILER_KEY=$VITE_MAPTILER_KEY VITE_TILE_URL=$VITE_TILE_URL
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---- runtime stage: only what is needed to run ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./src/db/migrations
# Integrations file (hot-reloaded) and the demo block-list it reads.
COPY config ./config
COPY data/external ./data/external
USER node
EXPOSE 8080
CMD ["node", "dist/server/src/server.js"]
