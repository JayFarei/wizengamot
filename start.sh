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

# Configure Docker socket for Colima (macOS) if needed
if [ -z "$DOCKER_HOST" ]; then
    # Check for Colima socket first (common on macOS)
    COLIMA_SOCKET="$HOME/.colima/default/docker.sock"
    if [ -S "$COLIMA_SOCKET" ]; then
        export DOCKER_HOST="unix://$COLIMA_SOCKET"
        echo -e "Using Colima Docker socket"
    elif [ ! -S "/var/run/docker.sock" ]; then
        # Neither socket exists - try to start Colima if installed
        if command -v colima &>/dev/null; then
            echo -e "${YELLOW}Docker socket not found. Starting Colima...${NC}"
            colima start
            if [ -S "$COLIMA_SOCKET" ]; then
                export DOCKER_HOST="unix://$COLIMA_SOCKET"
            fi
        else
            echo -e "${YELLOW}Warning: Docker socket not found. Crawl4AI container may not start.${NC}"
            echo "If using Colima, run: colima start"
        fi
    fi
fi

# Start Crawl4AI container if not already running
CRAWL4AI_PORT=${CRAWL4AI_PORT:-11235}
CRAWLER_CONTAINER="wizengamot-crawler"

if ! docker ps --format '{{.Names}}' | grep -q "^${CRAWLER_CONTAINER}$"; then
    # Check if container exists but is stopped
    if docker ps -a --format '{{.Names}}' | grep -q "^${CRAWLER_CONTAINER}$"; then
        echo "Starting existing Crawl4AI container..."
        docker start "$CRAWLER_CONTAINER"
    else
        echo "Starting Crawl4AI on http://localhost:$CRAWL4AI_PORT..."
        docker run -d --name "$CRAWLER_CONTAINER" \
            -p "$CRAWL4AI_PORT:11235" \
            --memory=4g \
            unclecode/crawl4ai:latest
    fi

    # Wait for health check
    echo -n "Waiting for Crawl4AI to be ready"
    for i in {1..30}; do
        if curl -s "http://localhost:$CRAWL4AI_PORT/monitor/health" >/dev/null 2>&1; then
            echo -e " ${GREEN}ready${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done

    if ! curl -s "http://localhost:$CRAWL4AI_PORT/monitor/health" >/dev/null 2>&1; then
        echo -e " ${YELLOW}timeout (will continue anyway)${NC}"
    fi
else
    echo -e "Crawl4AI already running on http://localhost:$CRAWL4AI_PORT"
fi

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

# Start Qwen3-TTS service if not already running (native for MPS acceleration)
QWEN_TTS_PORT=${QWEN_TTS_PORT:-7860}
QWEN_TTS_PID=""
if ! lsof -nP -iTCP:$QWEN_TTS_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    if [ -d "$SCRIPT_DIR/services/qwen3-tts" ]; then
        echo "Starting Qwen3-TTS on http://localhost:$QWEN_TTS_PORT..."
        cd "$SCRIPT_DIR/services/qwen3-tts"
        uv run uvicorn server:app --host 0.0.0.0 --port $QWEN_TTS_PORT &
        QWEN_TTS_PID=$!
        cd "$SCRIPT_DIR"

        # Wait for health check
        echo -n "Waiting for Qwen3-TTS to be ready"
        for i in {1..30}; do
            if curl -s "http://localhost:$QWEN_TTS_PORT/health" >/dev/null 2>&1; then
                echo -e " ${GREEN}ready${NC}"
                break
            fi
            echo -n "."
            sleep 1
        done

        if ! curl -s "http://localhost:$QWEN_TTS_PORT/health" >/dev/null 2>&1; then
            echo -e " ${YELLOW}timeout (will continue anyway)${NC}"
        fi
    else
        echo -e "${YELLOW}Qwen3-TTS service not found, skipping...${NC}"
    fi
else
    echo -e "Qwen3-TTS already running on http://localhost:$QWEN_TTS_PORT"
fi

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
echo "  Backend:   http://localhost:8001"
echo "  Frontend:  http://localhost:5173"
if [ -n "$QWEN_TTS_PID" ] || lsof -nP -iTCP:$QWEN_TTS_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  Qwen3-TTS: http://localhost:$QWEN_TTS_PORT"
fi
echo ""
echo "Press Ctrl+C to stop all servers"

# Cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."

    # Stop Qwen3-TTS gracefully first (SIGINT allows lifespan cleanup)
    if [ -n "$QWEN_TTS_PID" ]; then
        echo "Stopping Qwen3-TTS service..."
        kill -INT $QWEN_TTS_PID 2>/dev/null

        # Wait up to 10 seconds for graceful shutdown
        for i in {1..10}; do
            if ! kill -0 $QWEN_TTS_PID 2>/dev/null; then
                echo "  Qwen3-TTS stopped cleanly"
                break
            fi
            sleep 1
        done

        # Force kill if still running
        if kill -0 $QWEN_TTS_PID 2>/dev/null; then
            echo "  Force stopping Qwen3-TTS..."
            kill -9 $QWEN_TTS_PID 2>/dev/null
        fi
    fi

    # Kill process groups to ensure child processes are also terminated
    kill -- -$BACKEND_PID 2>/dev/null || kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null

    # Stop Crawl4AI container
    if docker ps --format '{{.Names}}' | grep -q "^${CRAWLER_CONTAINER}$"; then
        echo "Stopping Crawl4AI container..."
        docker stop "$CRAWLER_CONTAINER" >/dev/null 2>&1
    fi
    rm -f "$PID_FILE"
    echo "Done."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait
