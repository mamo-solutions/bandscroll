# ---- Stage 1: build the React client ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: build the Node server ----
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Stage 3: production image ----
FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app/server

# Install only production deps for the server.
COPY server/package*.json ./
RUN npm ci --omit=dev

# Compiled server + built client (served statically by the server).
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ../client/dist

# Uploads live outside the build; mounted as a volume in compose.
VOLUME ["/uploads"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
