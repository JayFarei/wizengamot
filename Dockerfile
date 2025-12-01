# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY frontend/ ./
RUN npm run build

# Stage 2: Final image with Python + nginx
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for Python package management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy Python project files and install dependencies
COPY pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml

# Copy backend code
COPY backend/ ./backend/

# Copy system prompts (will be overwritten by volume mount if exists)
COPY prompts/ ./prompts/

# Copy built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Copy configuration files
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create data and config directories
RUN mkdir -p /app/data/conversations /app/data/config

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data/conversations \
    PROMPTS_DIR=/app/prompts \
    CONFIG_DIR=/app/data/config

EXPOSE 80

# Use supervisord to run both nginx and uvicorn
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
