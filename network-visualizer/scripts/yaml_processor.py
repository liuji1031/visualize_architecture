#!/usr/bin/env python3
"""
YAML Processor using OmegaConf

This script processes YAML configuration files using OmegaConf to resolve
interpolation expressions like ${some.variable}. It saves the processed
YAML as a temporary file for the React Flow pipeline to use.
"""

import os
import sys
import tempfile
import argparse
from pathlib import Path
from typing import Dict, Any, Optional

try:
    from omegaconf import OmegaConf
    import yaml
except ImportError:
    print("Required packages not found. Please install them manually with:")
    print("pip install omegaconf pyyaml")
    print("\nAlternatively, you can install them using your system package manager:")
    print("For Ubuntu/Debian: sudo apt-get install python3-pip && pip3 install omegaconf pyyaml")
    print("For macOS: brew install python3 && pip3 install omegaconf pyyaml")
    sys.exit(1)


def process_yaml(input_file: str, output_file: Optional[str] = None) -> str:
    """
    Process a YAML file using OmegaConf to resolve interpolation expressions.
    
    Args:
        input_file: Path to the input YAML file
        output_file: Path to save the processed YAML file (optional)
        
    Returns:
        Path to the processed YAML file
    """
    # Load the YAML file using OmegaConf
    try:
        config = OmegaConf.load(input_file)
    except Exception as e:
        print(f"Error loading YAML file: {e}")
        sys.exit(1)
    
    # Resolve interpolation expressions
    resolved_config = OmegaConf.to_container(config, resolve=True)
    
    # If no output file is specified, create a temporary file
    if output_file is None:
        temp_dir = tempfile.gettempdir()
        input_filename = os.path.basename(input_file)
        output_file = os.path.join(temp_dir, f"processed_{input_filename}")
    
    # Save the processed YAML to the output file
    try:
        with open(output_file, 'w') as f:
            yaml.dump(resolved_config, f, default_flow_style=False)
    except Exception as e:
        print(f"Error saving processed YAML file: {e}")
        sys.exit(1)
    
    print(f"Processed YAML saved to: {output_file}")
    return output_file


def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(description='Process YAML files with OmegaConf')
    parser.add_argument('input_file', help='Path to the input YAML file')
    parser.add_argument('-o', '--output', help='Path to save the processed YAML file (optional)')
    
    args = parser.parse_args()
    
    # Process the YAML file
    output_file = process_yaml(args.input_file, args.output)
    
    # Return the path to the processed file
    return output_file


if __name__ == "__main__":
    main()
