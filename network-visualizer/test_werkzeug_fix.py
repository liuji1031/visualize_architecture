#!/usr/bin/env python3
"""
Test script for verifying the Werkzeug fix

This script tests that the Werkzeug version is compatible with Flask
by importing the necessary modules.
"""

import os
import sys
import importlib

def main():
    """Main entry point for the script."""
    print("Testing Werkzeug compatibility with Flask...")
    
    try:
        # Import Flask
        import flask
        print(f"Flask version: {flask.__version__}")
        
        # Import Werkzeug
        import werkzeug
        print(f"Werkzeug version: {werkzeug.__version__}")
        
        # Try to import the problematic module
        from werkzeug.urls import url_quote
        print("Successfully imported url_quote from werkzeug.urls")
        
        # Try to import other modules used by Flask
        from werkzeug.utils import secure_filename
        print("Successfully imported secure_filename from werkzeug.utils")
        
        print("\nAll imports successful! The Werkzeug version is compatible with Flask.")
        return True
    except ImportError as e:
        print(f"\nImport error: {e}")
        print("\nThe Werkzeug version is not compatible with Flask.")
        print("Please run ./setup_venv.sh to recreate the virtual environment with the correct dependencies.")
        return False

if __name__ == "__main__":
    main()
