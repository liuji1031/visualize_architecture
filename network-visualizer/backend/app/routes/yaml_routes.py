from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
import os
import tempfile
import shutil
import zipfile
import io
from ..services.yaml_service import (
    parse_yaml_content, 
    process_yaml_file, 
    fetch_yaml_file, 
    find_all_config_references
)

# Create a blueprint for YAML routes
yaml_bp = Blueprint('yaml', __name__, url_prefix='/api/yaml')

@yaml_bp.route('/parse', methods=['POST'])
def parse():
    """
    Parse YAML content provided in the request body.
    
    Request body:
        content: YAML content as a string
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    data = request.json
    
    if not data or 'content' not in data:
        return jsonify({'error': 'No content provided'}), 400
    
    try:
        # Parse the YAML content
        config = parse_yaml_content(data['content'])
        
        return jsonify(config)
    except Exception as e:
        error_message = f"Error parsing YAML content: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/check-references', methods=['POST'])
def check_references():
    """
    Check a YAML file for references to other YAML files.
    
    Request body:
        file: YAML file to check
        
    Returns:
        List of paths to all referenced YAML files
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Save the file to a temporary location
        filename = secure_filename(file.filename)
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, filename)
        file.save(file_path)
        
        print(f"Checking references in uploaded YAML file: {file_path}")
        
        # Find all referenced files
        references = find_all_config_references(file_path)
        
        # Remove the uploaded file from the list of references
        if file_path in references:
            references.remove(file_path)
        
        # Return the list of referenced files
        return jsonify({
            'references': references,
            'count': len(references)
        })
    except Exception as e:
        error_message = f"Error checking references in YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500
    finally:
        # Clean up the temporary file
        if os.path.exists(file_path):
            os.remove(file_path)

@yaml_bp.route('/upload', methods=['POST'])
def upload():
    """
    Upload and process a YAML file.
    
    Request body:
        file: YAML file to upload
        auto_upload_references: Whether to automatically upload referenced files
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Check if auto_upload_references is enabled
    auto_upload_references = request.form.get('auto_upload_references', 'false').lower() == 'true'
    
    try:
        # Save the file to a temporary location
        filename = secure_filename(file.filename)
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, filename)
        file.save(file_path)
        
        print(f"Processing uploaded YAML file: {file_path}")
        
        # Get the base path for resolving relative paths
        base_path = os.path.dirname(file_path)
        
        # If auto_upload_references is enabled, find all referenced files
        if auto_upload_references:
            try:
                # Find all referenced files
                references = find_all_config_references(file_path)
                
                # Remove the uploaded file from the list of references
                if file_path in references:
                    references.remove(file_path)
                
                print(f"Found {len(references)} referenced files")
                
                # Log the referenced files
                for ref in references:
                    print(f"Referenced file: {ref}")
            except Exception as e:
                print(f"Error finding referenced files: {e}")
        
        # Process the YAML file
        config = process_yaml_file(file_path)
        
        # Clean up the temporary file
        os.remove(file_path)
        
        return jsonify(config)
    except Exception as e:
        error_message = f"Error processing YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/upload-folder', methods=['POST'])
def upload_folder():
    """
    Upload a folder of YAML files (as a zip file) and process the main YAML file.
    
    Request body:
        zip_file: Zip file containing YAML files
        main_file: Path to the main YAML file within the zip file
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    if 'zip_file' not in request.files:
        return jsonify({'error': 'No zip file provided'}), 400
    
    zip_file = request.files['zip_file']
    
    if zip_file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Get the main file path
    main_file = request.form.get('main_file', '')
    if main_file == '':
        return jsonify({'error': 'No main file specified'}), 400
    
    try:
        # Create a temporary directory to extract the zip file
        temp_dir = tempfile.mkdtemp()
        
        print(f"Extracting zip file to: {temp_dir}")
        
        # Extract the zip file
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # Get the path to the main YAML file
        main_file_path = os.path.join(temp_dir, main_file)
        
        if not os.path.exists(main_file_path):
            return jsonify({'error': f'Main file not found: {main_file}'}), 400
        
        print(f"Processing main YAML file: {main_file_path}")
        
        # Process the main YAML file
        config = process_yaml_file(main_file_path)
        
        return jsonify(config)
    except Exception as e:
        error_message = f"Error processing YAML folder: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500
    finally:
        # Clean up the temporary directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

@yaml_bp.route('/fetch', methods=['POST'])
def fetch():
    """
    Fetch a YAML file from a URL and process it.
    
    Request body:
        url: URL of the YAML file
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    data = request.json
    
    if not data or 'url' not in data:
        return jsonify({'error': 'No URL provided'}), 400
    
    try:
        print(f"Fetching YAML file from URL: {data['url']}")
        
        # Fetch and process the YAML file
        config = fetch_yaml_file(data['url'])
        
        return jsonify(config)
    except Exception as e:
        error_message = f"Error fetching YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500
