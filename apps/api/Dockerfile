FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Journaux lisibles côté Algérie ; ce service ne fait aucune comparaison de
# date en base, donc pas le piège `timestamptz` d'`echangopromo`.
ENV TZ=Africa/Algiers
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000

# Sonde interne : `/health` est `@Public()` (pas de jeton requis) et ne lève
# jamais — un `unhealthy` ici signifie que le process Node est à terre, pas
# que Nominatim l'est.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Utilisateur non privilégié fourni par l'image (durcissement).
USER node
CMD ["node", "dist/main"]
