#!/bin/bash
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       InterviewAI — Starting Up          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Kill any existing processes
pkill -f "ts-node-dev" 2>/dev/null || true
pkill -f "next" 2>/dev/null || true
sleep 1

# Start Backend
echo "🚀 Starting Backend (port 4000)..."
cd "$(dirname "$0")/apps/server"
npx ts-node-dev --transpile-only src/index.ts &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# Wait for backend
sleep 3
echo ""

# Start Frontend
echo "🌐 Starting Frontend (port 3000)..."
cd "$(dirname "$0")/apps/web"
npx next dev -p 3000 &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

sleep 5
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║            ✅ READY!                      ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Home:      http://localhost:3000        ║"
echo "║  Backend:   http://localhost:4000/health ║"
echo "║                                          ║"
echo "║  Candidate Flow:                         ║"
echo "║  → Click 'Start as Candidate'            ║"
echo "║  → Hardware Check → Interview → Done     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all servers"

wait
