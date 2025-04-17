#!/usr/bin/env python3
"""
Test script for resolving config references

This script tests the YAML service's ability to resolve config references
by loading a YAML file with a config reference and verifying that it's resolved.
"""

import os
import sys
import json
from pathlib import Path

# Add the current directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.yaml_service import process_yaml_file

def main():
    """Main entry point for the script."""
    # Get the path to the YAML file
    yaml_file = os.path.join('..', '..', 'config', 'model.yaml')
    
    print(f"Current working directory: {os.getcwd()}")
    print(f"Testing with YAML file: {yaml_file}")
    print(f"Absolute path: {os.path.abspath(yaml_file)}")
    
    # Check if the file exists
    if not os.path.exists(yaml_file):
        print(f"Error: YAML file not found: {yaml_file}")
        print("Searching for the file in other locations...")
        
        # Try to find the file in other locations
        possible_paths = [
            os.path.join('config', 'model.yaml'),
            os.path.join('..', 'config', 'model.yaml'),
            os.path.join('..', '..', 'config', 'model.yaml'),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'config', 'model.yaml'),
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                yaml_file = path
                print(f"Found YAML file at: {yaml_file}")
                break
        else:
            print("Could not find the YAML file in any of the expected locations.")
            return
    
    # Process the YAML file
    try:
        config = process_yaml_file(yaml_file)
        
        # Print the result
        print("\nProcessed YAML configuration:")
        print(json.dumps(config, indent=2))
        
        # Check if the config references were resolved
        if 'modules' in config and 'conv1x1_1' in config['modules']:
            conv1x1_1_config = config['modules']['conv1x1_1']['config']
            if isinstance(conv1x1_1_config, dict):
                print("\nConfig reference for conv1x1_1 was successfully resolved:")
                print(json.dumps(conv1x1_1_config, indent=2))
                
                # Print the path that was used to resolve the reference
                config_path = config['modules']['conv1x1_1'].get('_resolved_config_path')
                if config_path:
                    print(f"\nResolved using path: {config_path}")
            else:
                print("\nConfig reference for conv1x1_1 was not resolved.")
                print(f"Type: {type(conv1x1_1_config)}")
                print(f"Value: {conv1x1_1_config}")
        else:
            print("\nModule conv1x1_1 not found in the configuration.")
    except Exception as e:
        print(f"Error processing YAML file: {e}")

if __name__ == "__main__":
    main()
