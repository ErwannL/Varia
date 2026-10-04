# syntax=docker/dockerfile:1
# Varia par Orqea — dashboard (lecture seule) en conteneur. Voir docs/INTEGRATION.md.
#
#   docker build -t varia .
#   docker run --rm -p 127.0.0.1:4321:4321 -v "$PWD/.varia:/data:ro" varia
#
# Le conteneur ne lance PAS de tests : il ne sert que les résultats d'un `varia test` fait sur la machine
# (ou ailleurs), lus dans /data (dossier de données ou racine ne contenant qu'un projet).

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY bin ./bin
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    VARIA_ORQEA_URL=https://orqea.dev
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 4321
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4321/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "bin/varia"]
# Écoute hors boucle locale : explicite (--allow-remote). Publier le port sur 127.0.0.1 côté hôte.
CMD ["dashboard", "--data-path", "/data", "--host", "0.0.0.0", "--allow-remote"]
