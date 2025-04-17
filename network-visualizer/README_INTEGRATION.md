# Network Visualizer Integration

This document explains how to run the integration between the backend and frontend of the Network Visualizer application.

## Prerequisites

- Python 3.6 or higher
- Node.js and npm
- Required Python packages: flask, flask-cors, pyyaml, omegaconf, requests

## Installation

1. Set up a Python virtual environment and install the required packages:
   ```
   cd network-visualizer
   ./setup_venv.sh
   ```

2. Install the required Node.js packages:
   ```
   cd network-visualizer
   npm install
   ```

The `setup_venv.sh` script will:
- Remove the existing virtual environment if it exists
- Create a new virtual environment in `backend/venv`
- Activate the virtual environment
- Install the required Python packages from `backend/requirements.txt`

If you encounter any dependency issues, you can recreate the virtual environment by running:
```
cd network-visualizer
./setup_venv.sh
```

## Running the Application

You can start both the backend and frontend servers using the provided script:

```
cd network-visualizer
./start_servers.sh
```

This will start:
- The backend server at http://localhost:5000
- The frontend server at http://localhost:3000

You can then access the application by opening http://localhost:3000 in your web browser.

## Testing the Integration

To test the integration between the backend and frontend, you can run the provided test script:

```
cd network-visualizer
./test_integration.py
```

This script will:
1. Start the backend server
2. Make a request to the backend API to process a YAML file
3. Verify that the response contains the expected data
4. Stop the backend server

If the test passes, it means that the backend is correctly processing YAML files and resolving config references.

## Manual Testing

You can also manually test the application by:

1. Starting the servers using `./start_servers.sh`
2. Opening http://localhost:3000 in your web browser
3. Uploading a YAML file using the "Upload YAML File" button
4. Verifying that the network visualization is displayed correctly

## YAML Processing Features

The backend provides the following YAML processing features:

1. **Interpolation Resolution**: Resolves interpolation expressions like `${defaults.in_channels}` using OmegaConf
2. **Config Reference Resolution**: If a module's "config" field is a string pointing to another YAML file, the backend will read and parse that file and replace the string with the parsed content
3. **Folder Upload**: The frontend allows uploading an entire folder of YAML files, preserving the folder structure
4. **Network Visualization**: The frontend visualizes the network structure defined in the YAML file

### Folder Upload

The application provides two ways to upload YAML files:

1. **Single File Upload**: Upload a single YAML file. This is useful for simple configurations that don't reference other files.
2. **Folder Upload**: Upload an entire folder of YAML files. This is useful for complex configurations that are split across multiple files.

When uploading a folder:
1. The user selects a folder containing YAML files
2. The application preserves the folder structure when saving the files to a temporary location
3. The user selects the main YAML file to process from a dropdown list
4. The application automatically resolves any references to other YAML files within the folder

This feature is particularly useful when working with complex YAML configurations that are split across multiple files and organized in a specific folder structure.

## API Endpoints

The backend provides the following API endpoints:

- `POST /api/yaml/parse`: Parse YAML content provided in the request body
- `POST /api/yaml/check-references`: Check a YAML file for references to other YAML files
- `POST /api/yaml/upload`: Upload and process a YAML file
- `POST /api/yaml/upload-folder`: Upload a folder of YAML files (as a zip file) and process the main YAML file
- `POST /api/yaml/fetch`: Fetch a YAML file from a URL and process it

## Example YAML Files

The repository includes example YAML files:

- `config/model.yaml`: A sample network architecture with a module that references another YAML file
- `config/build_config/conv1x1_1.yaml`: The referenced YAML file containing configuration for a Conv2d layer
