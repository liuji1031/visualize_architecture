#!/usr/bin/env python3
"""
Test script for the YAML service

This script tests the YAML service by loading a YAML file, processing it,
and printing the result.
"""

import os
import sys
import json

# Add the current directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.services.yaml_service import process_yaml_file

def main():
    """Main entry point for the script."""
    # Get the path to the YAML file
    yaml_file = os.path.join('..', '..', 'config', 'model.yaml')
    
    # Process the YAML file
    try:
        config = process_yaml_file(yaml_file)
        
        # Print the result
        print("Processed YAML configuration:")
        print(json.dumps(config, indent=2))
        
        # Check if the config references were resolved
        if 'modules' in config and 'conv1x1_1' in config['modules']:
            conv1x1_1_config = config['modules']['conv1x1_1']['config']
            if isinstance(conv1x1_1_config, dict):
                print("\nConfig reference for conv1x1_1 was successfully resolved:")
                print(json.dumps(conv1x1_1_config, indent=2))
            else:
                print("\nConfig reference for conv1x1_1 was not resolved.")
        else:
            print("\nModule conv1x1_1 not found in the configuration.")
    except Exception as e:
        print(f"Error processing YAML file: {e}")

if __name__ == "__main__":
    main()
