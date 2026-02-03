FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment variable for database path
ENV DB_PATH=/app/data/opinions.db

# Run the cron job
CMD ["npm", "run", "cron"]
