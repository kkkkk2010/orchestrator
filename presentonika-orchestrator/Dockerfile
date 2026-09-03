FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY themes ./themes
COPY assets ./assets
COPY README.md ./README.md
COPY docs ./docs

RUN npm test && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN addgroup --system --gid 1001 presentonika \
  && adduser --system --uid 1001 --ingroup presentonika presentonika \
  && mkdir -p /app/out /app/.tmp /app/.staged /app/layouts-local \
  && chown -R presentonika:presentonika /app

COPY --from=build --chown=presentonika:presentonika /app/dist ./dist
COPY --chown=presentonika:presentonika themes ./themes
COPY --chown=presentonika:presentonika assets ./assets

USER presentonika
EXPOSE 8080
STOPSIGNAL SIGTERM

CMD ["node", "dist/server.js"]
