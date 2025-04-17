#!/usr/bin/env python3
"""
Test script for folder upload functionality

This script tests the functionality to upload a folder of YAML files
and process the main YAML file.
"""

import os
import sys
import json
import zipfile
import tempfile
import requests
from pathlib import Path

# Constants
BACKEND_URL = "http://localhost:5000/api"
CONFIG_DIR = "config"
MAIN_YAML_FILE = "model.yaml"

def create_zip_from_folder(folder_path, main_file):
    """Create a zip file from a folder."""
    print(f"Creating zip file from folder: {folder_path}")
    
    # Create a temporary file for the zip
    temp_file = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
    temp_file.close()
    
    # Create a zip file
    with zipfile.ZipFile(temp_file.name, 'w') as zipf:
        # Walk through the folder and add all files to the zip
        for root, _, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                # Get the relative path
                rel_path = os.path.relpath(file_path, os.path.dirname(folder_path))
                print(f"Adding file to zip: {rel_path}")
                zipf.write(file_path, rel_path)
    
    return temp_file.name

def test_upload_folder():
    """Test the /api/yaml/upload-folder endpoint."""
    print("\nTesting /api/yaml/upload-folder endpoint...")
    
    # Check if the config directory exists
    if not os.path.exists(CONFIG_DIR):
        print(f"Error: Config directory not found: {CONFIG_DIR}")
        return False
    
    # Check if the main YAML file exists
    main_file_path = os.path.join(CONFIG_DIR, MAIN_YAML_FILE)
    if not os.path.exists(main_file_path):
        print(f"Error: Main YAML file not found: {main_file_path}")
        return False
    
    try:
        # Create a zip file from the config directory
        zip_file_path = create_zip_from_folder(CONFIG_DIR, MAIN_YAML_FILE)
        
        # Create a multipart form-data request
        files = {'zip_file': open(zip_file_path, 'rb')}
        data = {'main_file': MAIN_YAML_FILE}
        
        # Make a request to the backend API
        response = requests.post(
            f"{BACKEND_URL}/yaml/upload-folder",
            files=files,
            data=data
        )
        
        # Check the response
        if response.status_code == 200:
            print("Request successful!")
            config = response.json()
            
            # Check if the config references were resolved
            if 'modules' in config and 'conv1x1_1' in config['modules']:
                conv1x1_1_config = config['modules']['conv1x1_1']['config']
                if isinstance(conv1x1_1_config, dict):
                    print("Config reference for conv1x1_1 was successfully resolved:")
                    print(json.dumps(conv1x1_1_config, indent=2))
                    return True
                else:
                    print("Config reference for conv1x1_1 was not resolved.")
                    print(f"Type: {type(conv1x1_1_config)}")
                    print(f"Value: {conv1x1_1_config}")
                    return False
            else:
                print("Module conv1x1_1 not found in the configuration.")
                return False
        else:
            print(f"Request failed with status code {response.status_code}:")
            print(response.text)
            return False
    except Exception as e:
        print(f"Error uploading folder: {e}")
        return False
    finally:
        # Close the file
        files['zip_file'].close()
        
        # Remove the temporary zip file
        if os.path.exists(zip_file_path):
            os.remove(zip_file_path)

def main():
    """Main entry point for the script."""
    print("Testing folder upload functionality...")
    
    # Start the backend server if it's not already running
    print("Make sure the backend server is running before running this test.")
    print("You can start it by running: cd network-visualizer && ./start_servers.sh")
    
    # Test the upload-folder endpoint
    success = test_upload_folder()
    
    # Print the overall result
    if success:
        print("\nFolder upload test passed!")
        return True
    else:
        print("\nFolder upload test failed!")
        return False

if __name__ == "__main__":
    main()
