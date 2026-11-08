FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./package.json
RUN npm install --omit=dev
COPY api/src ./src
COPY db/migrations /db/migrations
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh","-c","node src/migrate.js && node src/server.js"]
