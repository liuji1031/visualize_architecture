#!/usr/bin/env python3
"""
Test script for the backend and frontend integration

This script tests the integration between the backend and frontend by:
1. Starting the backend server
2. Making a request to the backend API to process a YAML file
3. Verifying that the response contains the expected data
"""

import os
import sys
import json
import time
import subprocess
import requests
from pathlib import Path

# Constants
BACKEND_URL = "http://localhost:5000/api"
YAML_FILE_PATH = os.path.join("config", "model.yaml")

def start_backend_server():
    """Start the backend server."""
    print("Starting the backend server...")
    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    
    # Check if virtual environment exists
    venv_python = os.path.join(backend_dir, "venv", "bin", "python")
    if os.path.exists(venv_python):
        python_executable = venv_python
        print("Using virtual environment Python")
    else:
        python_executable = "python"
        print("Virtual environment not found, using system Python")
    
    process = subprocess.Popen(
        [python_executable, "app.py"],
        cwd=backend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for the server to start
    print("Waiting for the backend server to start...")
    time.sleep(3)
    
    return process

def stop_backend_server(process):
    """Stop the backend server."""
    print("Stopping the backend server...")
    process.terminate()
    process.wait()

def test_parse_yaml_content():
    """Test the /api/yaml/parse endpoint."""
    print("\nTesting /api/yaml/parse endpoint...")
    
    # Read the YAML file
    with open(YAML_FILE_PATH, "r") as f:
        yaml_content = f.read()
    
    # Make a request to the backend API
    response = requests.post(
        f"{BACKEND_URL}/yaml/parse",
        json={"content": yaml_content}
    )
    
    # Check the response
    if response.status_code == 200:
        print("Request successful!")
        data = response.json()
        
        # Check if the config references were resolved
        if 'modules' in data and 'conv1x1_1' in data['modules']:
            conv1x1_1_config = data['modules']['conv1x1_1']['config']
            if isinstance(conv1x1_1_config, dict):
                print("Config reference for conv1x1_1 was successfully resolved:")
                print(json.dumps(conv1x1_1_config, indent=2))
                return True
            else:
                print("Config reference for conv1x1_1 was not resolved.")
                return False
        else:
            print("Module conv1x1_1 not found in the configuration.")
            return False
    else:
        print(f"Request failed with status code {response.status_code}:")
        print(response.text)
        return False

def main():
    """Main entry point for the script."""
    # Start the backend server
    backend_process = start_backend_server()
    
    try:
        # Test the /api/yaml/parse endpoint
        success = test_parse_yaml_content()
        
        if success:
            print("\nIntegration test passed!")
        else:
            print("\nIntegration test failed!")
    finally:
        # Stop the backend server
        stop_backend_server(backend_process)

if __name__ == "__main__":
    main()
