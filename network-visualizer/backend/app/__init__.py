import os # Import os module
from flask import Flask
from flask_cors import CORS

def create_app():
    """
    Create and configure the Flask application.
    
    Returns:
        Configured Flask application
    """
    app = Flask(__name__)

    # Set a secret key for session management
    # IMPORTANT: Use a strong, unique secret in production, possibly from environment variables
    app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key-replace-in-prod')
    
    # Configure CORS more explicitly to allow credentials
    CORS(app, supports_credentials=True, origins=["http://localhost:3000","https://network-visualizer-36300.web.app"]) # Adjust origin if your frontend runs elsewhere
    
    # Register blueprints
    from .routes.yaml_routes import yaml_bp
    app.register_blueprint(yaml_bp)
    
    return app
