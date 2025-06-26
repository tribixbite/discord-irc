# Use Node.js official image
FROM node:20-alpine

# Install Bun
RUN npm install -g bun

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose the port that Railway will provide
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:$PORT/health || exit 1

# Start the server
CMD ["npm", "run", "start:server"]