FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies separately to leverage Docker cache
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

# Create data directory (mounted as volume in compose)
RUN mkdir -p /app/data

# Default command
EXPOSE 3000
CMD ["npm", "start"]

