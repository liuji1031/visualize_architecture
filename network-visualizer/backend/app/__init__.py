from flask import Flask
from flask_cors import CORS

def create_app():
    """
    Create and configure the Flask application.
    
    Returns:
        Configured Flask application
    """
    app = Flask(__name__)
    
    # Configure CORS to allow requests from the frontend
    CORS(app)
    
    # Register blueprints
    from .routes.yaml_routes import yaml_bp
    app.register_blueprint(yaml_bp)
    
    return app
