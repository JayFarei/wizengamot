#!/bin/bash
# Deployment script for LLM Council
# Pulls latest code, backs up data, runs migrations, and swaps containers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "============================================"
echo "  LLM Council Deployment"
echo "  $(date)"
echo "============================================"
echo ""

# Step 1: Pull latest code
echo "Step 1/6: Pulling latest code..."
git pull
echo "Done."
echo ""

# Step 2: Backup data
echo "Step 2/6: Backing up data..."
"$SCRIPT_DIR/backup.sh"
echo ""

# Step 3: Run migrations
echo "Step 3/6: Running migrations..."
"$SCRIPT_DIR/migrate.sh"
echo ""

# Step 4: Build new image
echo "Step 4/6: Building new Docker image..."
docker compose build --no-cache
echo "Done."
echo ""

# Step 5: Swap containers
echo "Step 5/6: Swapping containers..."
docker compose down
docker compose up -d
echo "Done."
echo ""

# Step 6: Health check
echo "Step 6/6: Running health check..."
echo "Waiting for container to start..."
sleep 5

MAX_RETRIES=12
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:8080/api/config > /dev/null 2>&1; then
        echo "Health check passed!"
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "  Waiting for service to be ready... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "WARNING: Health check failed after $MAX_RETRIES attempts"
    echo "Check container logs: docker compose logs"
    exit 1
fi

# Cleanup old images (optional)
echo ""
echo "Cleaning up old images..."
docker image prune -f

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "  App available at: http://wizengamot.lan:8080"
echo "  (or http://localhost:8080)"
echo "============================================"
