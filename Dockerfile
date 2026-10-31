# Étape 1 : construit l'interface (design system SGDF, @sgdf/ui) dans public/ui
FROM node:24-alpine AS interface
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY client/ client/
COPY scripts/ scripts/
COPY public/ public/
RUN npm run build

# Étape 2 : image finale, un seul conteneur Node : site, admin, relevé des prévisions et mails.
# Les données (base SQLite + historique.json) sont dans le volume /data.
FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
RUN apk add --no-cache tzdata

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ server/
COPY --from=interface /app/public/ public/
COPY seed/ seed/
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/index.mjs"]
