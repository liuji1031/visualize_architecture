#!/usr/bin/env python3
"""
Test script for checking YAML references

This script tests the functionality to detect and resolve references to other YAML files
in a YAML configuration file.
"""

import os
import sys
import json
import requests
from pathlib import Path

# Constants
BACKEND_URL = "http://localhost:5000/api"
YAML_FILE_PATH = "/home/ji-liu/GitHub/visualize_architecture/config/model.yaml" #os.path.join("..", "config", "model.yaml")

def test_check_references():
    """Test the /api/yaml/check-references endpoint."""
    print("\nTesting /api/yaml/check-references endpoint...")
    
    # Check if the YAML file exists
    if not os.path.exists(YAML_FILE_PATH):
        print(f"Error: YAML file not found: {YAML_FILE_PATH}")
        return False
    
    # Create a multipart form-data request
    files = {'file': open(YAML_FILE_PATH, 'rb')}
    
    try:
        # Make a request to the backend API
        response = requests.post(
            f"{BACKEND_URL}/yaml/check-references",
            files=files
        )
        
        # Check the response
        if response.status_code == 200:
            print("Request successful!")
            data = response.json()
            
            # Check if references were found
            if 'references' in data and 'count' in data:
                print(f"Found {data['count']} referenced files:")
                for ref in data['references']:
                    print(f"  - {ref}")
                return True
            else:
                print("No references found in the response.")
                return False
        else:
            print(f"Request failed with status code {response.status_code}:")
            print(response.text)
            return False
    except Exception as e:
        print(f"Error checking references: {e}")
        return False
    finally:
        # Close the file
        files['file'].close()

def test_upload_with_references():
    """Test the /api/yaml/upload endpoint with auto_upload_references=true."""
    print("\nTesting /api/yaml/upload endpoint with auto_upload_references=true...")
    
    # Check if the YAML file exists
    if not os.path.exists(YAML_FILE_PATH):
        print(f"Error: YAML file not found: {YAML_FILE_PATH}")
        return False
    
    # Create a multipart form-data request
    files = {'file': open(YAML_FILE_PATH, 'rb')}
    data = {'auto_upload_references': 'true'}
    
    try:
        # Make a request to the backend API
        response = requests.post(
            f"{BACKEND_URL}/yaml/upload",
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
        print(f"Error uploading YAML file: {e}")
        return False
    finally:
        # Close the file
        files['file'].close()

def main():
    """Main entry point for the script."""
    print("Testing YAML references functionality...")
    
    # Start the backend server if it's not already running
    print("Make sure the backend server is running before running this test.")
    print("You can start it by running: cd network-visualizer && ./start_servers.sh")
    
    # Test the check-references endpoint
    check_references_success = test_check_references()
    
    # Test the upload endpoint with auto_upload_references=true
    upload_success = test_upload_with_references()
    
    # Print the overall result
    if check_references_success and upload_success:
        print("\nAll tests passed!")
        return True
    else:
        print("\nSome tests failed.")
        return False

if __name__ == "__main__":
    main()
