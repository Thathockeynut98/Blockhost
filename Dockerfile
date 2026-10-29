FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates curl tar gzip unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data/uploads /app/data/backups
EXPOSE 8080
CMD ["node","server.js"]
