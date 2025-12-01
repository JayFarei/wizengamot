#!/bin/bash
# Backup script for LLM Council conversation data
# Creates timestamped backups and maintains rotation (keeps last 5)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUPS_DIR="$PROJECT_ROOT/backups"
MAX_BACKUPS=5

# Determine data source - Docker volume or local
CONTAINER_NAME="llm-council"
VOLUME_NAME="llm-council-data"

echo "=== LLM Council Backup ==="

# Create backups directory
mkdir -p "$BACKUPS_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUPS_DIR/conversations_$TIMESTAMP.tar.gz"

# Check if container is running (Docker backup)
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container detected. Backing up from Docker volume..."

    # Create backup from running container
    docker run --rm \
        -v "$VOLUME_NAME:/data:ro" \
        -v "$BACKUPS_DIR:/backup" \
        alpine \
        tar czf "/backup/conversations_$TIMESTAMP.tar.gz" -C /data .

    echo "Backed up Docker volume to: $BACKUP_FILE"

elif [ -d "$PROJECT_ROOT/data/conversations" ]; then
    # Local backup (no Docker)
    echo "Backing up local data directory..."

    tar czf "$BACKUP_FILE" -C "$PROJECT_ROOT/data" conversations

    echo "Backed up local data to: $BACKUP_FILE"

else
    echo "No data found to backup."
    exit 0
fi

# Show backup size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup size: $BACKUP_SIZE"

# Rotate old backups (keep only MAX_BACKUPS)
echo ""
echo "Rotating old backups (keeping last $MAX_BACKUPS)..."

BACKUP_COUNT=$(ls -1 "$BACKUPS_DIR"/conversations_*.tar.gz 2>/dev/null | wc -l)

if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
    echo "Deleting $DELETE_COUNT old backup(s)..."

    ls -1t "$BACKUPS_DIR"/conversations_*.tar.gz | tail -n "$DELETE_COUNT" | while read old_backup; do
        echo "  Removing: $(basename "$old_backup")"
        rm "$old_backup"
    done
fi

# List current backups
echo ""
echo "Current backups:"
ls -lh "$BACKUPS_DIR"/conversations_*.tar.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

echo ""
echo "=== Backup complete ==="
