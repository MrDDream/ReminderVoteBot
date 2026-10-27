FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies separately to leverage Docker cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY src ./src

# Run as the unprivileged "node" user of the base image; data/ (mounted as a volume) must belong to it
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# node as the main process receives SIGTERM directly (graceful shutdown)
CMD ["node", "src/index.js"]
