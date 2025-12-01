#!/bin/bash
# Schema migration runner for LLM Council
# Runs Python migration scripts in order to update conversation JSON structure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# Data directory - check Docker volume first, then local
if [ -d "/app/data/conversations" ]; then
    DATA_DIR="/app/data/conversations"
else
    DATA_DIR="$PROJECT_ROOT/data/conversations"
fi

SCHEMA_VERSION_FILE="$DATA_DIR/.schema_version"

# Get current schema version
get_current_version() {
    if [ -f "$SCHEMA_VERSION_FILE" ]; then
        cat "$SCHEMA_VERSION_FILE"
    else
        echo "0"
    fi
}

# Set schema version
set_version() {
    echo "$1" > "$SCHEMA_VERSION_FILE"
}

# Get list of migration files sorted by version number
get_migrations() {
    if [ -d "$MIGRATIONS_DIR" ]; then
        ls "$MIGRATIONS_DIR"/*.py 2>/dev/null | sort -V || true
    fi
}

echo "=== LLM Council Schema Migration ==="
echo "Data directory: $DATA_DIR"

# Ensure data directory exists
mkdir -p "$DATA_DIR"

CURRENT_VERSION=$(get_current_version)
echo "Current schema version: $CURRENT_VERSION"

# Find and run migrations
MIGRATIONS_RUN=0
for migration_file in $(get_migrations); do
    # Extract version number from filename (e.g., 001_description.py -> 1)
    filename=$(basename "$migration_file")
    version=$(echo "$filename" | sed 's/^0*//' | cut -d'_' -f1)

    if [ "$version" -gt "$CURRENT_VERSION" ]; then
        echo ""
        echo "Running migration $filename..."

        # Run the migration
        if python3 "$migration_file" "$DATA_DIR" up; then
            set_version "$version"
            echo "Migration $filename completed. Schema now at version $version"
            MIGRATIONS_RUN=$((MIGRATIONS_RUN + 1))
        else
            echo "ERROR: Migration $filename failed!"
            exit 1
        fi
    fi
done

if [ $MIGRATIONS_RUN -eq 0 ]; then
    echo "No migrations to run. Schema is up to date."
else
    echo ""
    echo "=== Migration complete. Ran $MIGRATIONS_RUN migration(s). ==="
fi
