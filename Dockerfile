# docker compose up -d (après avoir rempli le .env)
FROM node:20-alpine
ENV NODE_ENV=production TZ=Europe/Paris DATA_DIR=/data
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
