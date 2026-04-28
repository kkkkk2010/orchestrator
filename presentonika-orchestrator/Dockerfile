FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY themes ./themes
COPY README.md ./README.md
COPY docs ./docs

RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY themes ./themes

RUN mkdir -p /app/out /app/.tmp /app/.staged /app/layouts-local
EXPOSE 8080

CMD ["node", "dist/server.js"]
