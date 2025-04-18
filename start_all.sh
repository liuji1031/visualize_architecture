#!/bin/bash

# Navigate to the backend directory
echo "Starting backend server..."
cd network-visualizer/backend

# Activate virtual environment and start Flask server in the background
# Assuming the virtual environment is named 'venv'
source venv/bin/activate
flask run --no-reload &
BACKEND_PID=$!
echo "Backend server started with PID $BACKEND_PID"

# Navigate back to the root and then to the frontend directory
cd ../.. 
cd network-visualizer

# Start React frontend server in the background
echo "Starting frontend server..."
npm start &
FRONTEND_PID=$!
echo "Frontend server started with PID $FRONTEND_PID"

# Navigate back to the root directory (optional, returns to where script was run)
cd ..

echo "Both servers are starting in the background."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

# Wait for both processes to complete (optional: remove if you want the script to exit immediately)
# Use 'trap' to kill background jobs if the script is interrupted
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID" SIGINT SIGTERM
wait $BACKEND_PID
wait $FRONTEND_PID
