# Import the create_app function from the app package
import sys
import os

# Add the current directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import create_app

app = create_app()

# Set a secret key for session management
# IMPORTANT: Use a strong, unique secret in production, possibly from environment variables
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key-replace-in-prod') 

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
