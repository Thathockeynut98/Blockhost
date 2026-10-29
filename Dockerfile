FROM node:22-bookworm
RUN apt-get update && apt-get install -y openjdk-17-jre-headless openjdk-21-jre-headless procps iproute2 util-linux curl ca-certificates tar && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data /app/servers/main/{mods,plugins,backups}
EXPOSE 8080 25565
CMD ["node","server.js"]