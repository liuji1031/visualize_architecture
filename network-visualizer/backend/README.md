# Network Visualizer Backend

This is the Flask backend for the Network Visualizer application. It provides API endpoints for parsing YAML files and resolving config references.

## Project Structure

```
backend/
├── app/
│   ├── __init__.py          # Flask application initialization
│   ├── routes/
│   │   ├── __init__.py      # Route initialization
│   │   └── yaml_routes.py   # YAML API routes
│   └── services/
│       ├── __init__.py      # Service initialization
│       ├── yaml_service.py  # YAML processing service
│       └── yaml_processor.py # Python script for YAML processing
├── app.py                   # Main application entry point
├── requirements.txt         # Python dependencies
└── README.md                # This file
```

## API Endpoints

The backend provides the following API endpoints:

- `POST /api/yaml/parse` - Parse YAML content
- `POST /api/yaml/upload` - Upload and process a YAML file
- `POST /api/yaml/fetch` - Fetch a YAML file from a URL and process it

## Setup and Running

1. Install the required packages:
   ```
   pip install -r requirements.txt
   ```

2. Run the application:
   ```
   python app.py
   ```

3. The API will be available at http://localhost:5000/api
