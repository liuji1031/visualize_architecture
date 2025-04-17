#!/bin/bash
# Set up a Python virtual environment for the backend

# Remove the existing virtual environment if it exists
if [ -d "backend/venv" ]; then
    echo "Removing existing virtual environment..."
    rm -rf backend/venv
fi

# Create a new virtual environment
echo "Creating virtual environment..."
python3 -m venv backend/venv

# Activate the virtual environment
source backend/venv/bin/activate

# Install the required packages
echo "Installing required packages..."
pip install -r backend/requirements.txt

echo "Virtual environment setup complete!"
echo "To activate the virtual environment, run:"
echo "source backend/venv/bin/activate"
