# =========================================================================
# KTS POS - جمعية المعلمين الكويتية
# Dockerfile for Node.js 22 LTS (Native node:sqlite support)
# =========================================================================

FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies for production
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source files
COPY server ./server
COPY client ./client
COPY start.cmd ./

# Create persistent directories
RUN mkdir -p database/backups client/images/uploads

# Environment settings
ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0

EXPOSE 5000

# Run server with native node
CMD ["node", "server/src/server.js"]

