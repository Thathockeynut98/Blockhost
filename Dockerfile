FROM node:22-bookworm
RUN apt-get update && apt-get install -y openjdk-21-jre-headless procps iproute2 util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data /app/servers/main/{mods,plugins,backups}
EXPOSE 8080 25565
CMD ["node","server.js"]