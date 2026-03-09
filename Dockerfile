# ---- Build stage ----
FROM node:22-slim AS build

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy workspace package.json files first (for layer caching)
COPY server/package.json server/
COPY ui/package.json ui/

RUN npm ci

# Copy source code
COPY server/ server/
COPY ui/ ui/

# Build both workspaces
RUN npm -w ui run build && npm -w server run build

# ---- Production stage ----
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/

# Install production deps only
RUN npm ci -w server --omit=dev

# Copy built artifacts
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/ui/dist ui/dist

# Cloud Run sets PORT env var
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
