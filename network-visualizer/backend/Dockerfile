FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn

COPY . .

# Set environment variables
ENV FLASK_SECRET_KEY=${FLASK_SECRET_KEY}

# Create a directory for temporary files
RUN mkdir -p /tmp/yaml_uploads
ENV TEMP_UPLOAD_DIR="/tmp/yaml_uploads"

# Expose the port
EXPOSE 8080

# Use Gunicorn as the production server with the WSGI entry point
CMD exec gunicorn --bind :8080 --workers 1 --threads 8 wsgi:app
