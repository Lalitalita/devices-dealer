# ---- 1) build de l'interface ----
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2) dépendances serveur ----
FROM node:22-slim AS deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- 3) image finale ----
FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data WEB_DIR=/app/web PORT=8080
WORKDIR /app/server
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/test/emulator.js server/test/emulator-cli.js ./test/
COPY --from=web /web/dist /app/web
# (root dans le conteneur : simplifie le volume ./data et l'accès aux /dev/ttyUSB*)
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
