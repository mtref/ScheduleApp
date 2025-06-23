# Stage 1: Build Frontend
FROM node:18 AS builder
WORKDIR /app

# Copy ONLY package files first to leverage Docker cache
COPY frontend/package.json frontend/package-lock.json* ./
# Install dependencies in a clean environment
RUN npm install

# Copy the rest of the source code. .dockerignore will prevent local node_modules from being copied.
COPY frontend/ ./

# Run the build command
RUN npm run build

# Stage 2: Final Backend Image
FROM node:18
WORKDIR /app

# Copy backend package files and install dependencies
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
# Copy backend source code after installing dependencies
COPY backend/ ./

# Copy the built frontend from the builder stage
# The build output is at /app/dist in the builder stage
COPY --from=builder /app/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "index.js"]
