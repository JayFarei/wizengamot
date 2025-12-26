#!/bin/bash

# Wizengamot - Start script

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configure git to use tracked hooks directory
git config core.hooksPath hooks 2>/dev/null

# Parse arguments
SKIP_CHECKS=0
for arg in "$@"; do
    case $arg in
        --skip-checks)
            SKIP_CHECKS=1
            shift
            ;;
        --help|-h)
            echo "Usage: ./start.sh [options]"
            echo ""
            echo "Options:"
            echo "  --skip-checks  Skip dependency validation"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
    esac
done

# Prevent multiple start.sh instances (and port collisions)
PID_FILE="/tmp/wizengamot.pid"
if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Wizengamot already running (PID $OLD_PID)."
        echo "If this is stale, remove $PID_FILE and retry."
        exit 1
    fi
fi
echo $$ > "$PID_FILE"

# Guard against port conflicts
if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8001 already in use. Stop the existing backend before starting."
    rm -f "$PID_FILE"
    exit 1
fi
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 5173 already in use. Stop the existing frontend before starting."
    rm -f "$PID_FILE"
    exit 1
fi

echo ""
echo "Starting Wizengamot..."
echo ""

# Run dependency checks unless skipped
if [ $SKIP_CHECKS -eq 0 ]; then
    if [ -f "$SCRIPT_DIR/scripts/check-deps.sh" ]; then
        bash "$SCRIPT_DIR/scripts/check-deps.sh"
        DEPS_STATUS=$?

        if [ $DEPS_STATUS -eq 1 ]; then
            echo ""
            echo -e "${RED}Cannot start: missing required dependencies.${NC}"
            echo "Install the missing dependencies and try again."
            exit 1
        fi
        # Status 2 means optional deps missing, continue with warning
    fi
fi

# Set environment variables to suppress warnings
export TOKENIZERS_PARALLELISM=false

# Start backend with auto-restart (dev process manager)
# This mimics Docker's supervisord behavior for seamless updates
echo "Starting backend on http://localhost:8001..."
(
    # Handle signals to cleanly terminate child process
    trap 'kill $CHILD_PID 2>/dev/null; exit 0' SIGINT SIGTERM

    while true; do
        uv run python -m backend.main &
        CHILD_PID=$!
        wait $CHILD_PID
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 0 ]; then
            echo -e "${YELLOW}Backend exited (code 0), restarting...${NC}"
            sleep 1
        else
            echo -e "${RED}Backend crashed (code $EXIT_CODE), restarting in 3s...${NC}"
            sleep 3
        fi
    done
) &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

# Start frontend
echo "Starting frontend on http://localhost:5173..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
cd "$SCRIPT_DIR"

echo ""
echo -e "${GREEN}Wizengamot is running!${NC}"
echo "  Backend:  http://localhost:8001"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all servers"

# Cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    # Kill process groups to ensure child processes are also terminated
    kill -- -$BACKEND_PID 2>/dev/null || kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    rm -f "$PID_FILE"
    echo "Done."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait
