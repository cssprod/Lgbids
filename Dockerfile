# Build stage: compile the server and the web UI.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Run stage: only what is needed at runtime.
FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 3000
USER node
# APP_PASSWORD must be set: the server refuses to listen beyond localhost without one.
CMD ["node", "dist/server/index.js"]
