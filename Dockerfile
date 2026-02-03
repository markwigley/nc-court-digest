FROM ghcr.io/puppeteer/puppeteer:23.0.0

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment variables
ENV DB_PATH=/app/data/opinions.db
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Run the cron job
CMD ["npm", "run", "cron"]
