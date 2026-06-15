# Use Microsoft's official Playwright image — Chromium + all system deps pre-installed.
# Version MUST match the "playwright" version in package.json so the bundled
# browser binaries line up. Bump both together when you upgrade.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install Node dependencies
RUN npm ci

# Copy the rest of the project
COPY . .

# Expose the port (Railway reads this automatically)
EXPOSE 3000

# Start the audit server
CMD ["npx", "tsx", "server.ts"]
