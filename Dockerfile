# Single-stage build. node:20-slim + build tools for the better-sqlite3 native addon.
FROM node:20-bookworm-slim

# Build toolchain for better-sqlite3 (falls back to source build if no prebuilt).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Render/Railway inject PORT; default to 3000 locally.
ENV PORT=3000
EXPOSE 3000

# Health check hits the same endpoint Render/Railway can use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
