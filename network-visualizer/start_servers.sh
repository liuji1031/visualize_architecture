#!/bin/bash
# Start both the backend and frontend servers

# Activate the virtual environment if it exists
if [ -d "backend/venv" ]; then
    echo "Activating virtual environment..."
    source backend/venv/bin/activate
else
    echo "Virtual environment not found. Please run ./setup_venv.sh first."
    exit 1
fi

# Start the backend server
echo "Starting the backend server..."
cd backend
python app.py &
BACKEND_PID=$!
echo "Backend server started with PID $BACKEND_PID"

# Wait for the backend server to start
echo "Waiting for the backend server to start..."
sleep 3

# Start the frontend server
echo "Starting the frontend server..."
cd ..
npm start &
FRONTEND_PID=$!
echo "Frontend server started with PID $FRONTEND_PID"

# Wait for the user to press Ctrl+C
echo "Press Ctrl+C to stop the servers"
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
