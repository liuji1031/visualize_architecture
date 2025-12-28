from flask import Blueprint, request, jsonify, make_response
from werkzeug.utils import secure_filename
import os
import tempfile
import traceback
import shutil
import zipfile
import uuid

from ..services.yaml_service import (
    parse_yaml_content,
    process_yaml_file,
    fetch_yaml_file,
    find_all_config_references
)

from ..services.image_service import crop_image

# --- Local Storage Configuration ---
# Define the base directory for local file storage
LOCAL_UPLOAD_DIR = os.environ.get('LOCAL_UPLOAD_DIR', os.path.join(tempfile.gettempdir(), 'yaml_uploads'))
LOCAL_PRESETS_DIR = os.environ.get('LOCAL_PRESETS_DIR', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'presets'))

# Ensure directories exist
os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
os.makedirs(LOCAL_PRESETS_DIR, exist_ok=True)

print(f"Local storage: Upload directory: {LOCAL_UPLOAD_DIR}")
print(f"Local storage: Presets directory: {LOCAL_PRESETS_DIR}")
# --- End Local Storage Configuration ---

# Create a blueprint for YAML routes
yaml_bp = Blueprint('yaml', __name__, url_prefix='/api/yaml')

# --- Helper Functions for Local Storage ---
def get_upload_path(upload_id: str, relative_path: str = '') -> str:
    """Get the full local path for an upload."""
    upload_base = os.path.join(LOCAL_UPLOAD_DIR, 'uploads', upload_id)
    if relative_path:
        return os.path.join(upload_base, relative_path)
    return upload_base

def copy_file_to_upload(local_file_path: str, upload_id: str, relative_path: str):
    """Copy a file to the local upload directory."""
    dest_path = get_upload_path(upload_id, relative_path)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    shutil.copy2(local_file_path, dest_path)
    print(f"Copied {local_file_path} to {dest_path}")
    return dest_path

def delete_upload_directory(upload_id: str):
    """Delete an entire upload directory."""
    upload_path = get_upload_path(upload_id)
    if os.path.exists(upload_path):
        shutil.rmtree(upload_path)
        print(f"Deleted upload directory: {upload_path}")

# --- Modified Routes ---

# Renamed from /cleanup-temp
@yaml_bp.route('/cleanup-upload', methods=['POST'])
def cleanup_upload():
    """
    Clean up the local files associated with a specific upload ID.
    Request body:
        uploadId: The unique ID for the upload session.
    """
    data = request.json
    upload_id = data.get('uploadId')

    if not upload_id:
        return jsonify({'error': 'No uploadId provided'}), 400

    try:
        delete_upload_directory(upload_id)
        return jsonify({'message': f'Upload context {upload_id} cleaned up successfully'}), 200
    except Exception as e:
        error_message = f"Error cleaning up upload context {upload_id}: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/parse', methods=['POST'])
def parse():
    """
    Parse YAML content provided in the request body. (No GCS interaction needed here)
    """
    data = request.json
    if not data or 'content' not in data:
        return jsonify({'error': 'No content provided'}), 400
    try:
        # Parse the YAML content directly (no GCS context)
        # Assuming parse_yaml_content doesn't need GCS for direct parsing
        config = parse_yaml_content(data['content'])
        return jsonify(config)
    except Exception as e:
        error_message = f"Error parsing YAML content: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

# /check-references might be less useful now, as references are resolved dynamically from GCS.
# Keeping it for now, but it only checks the main file locally.
@yaml_bp.route('/check-references', methods=['POST'])
def check_references():
    """
    Check a single YAML file (locally) for references.
    NOTE: This does not check references within the GCS context.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    local_temp_dir = None
    file_path = None
    try:
        local_temp_dir = tempfile.mkdtemp()
        filename = secure_filename(file.filename)
        file_path = os.path.join(local_temp_dir, filename)
        file.save(file_path)
        print(f"Checking references in temporary local file: {file_path}")
        # find_all_config_references needs adaptation for GCS if it's to be fully functional
        # For now, it only checks the main file locally.
        references = find_all_config_references(file_path) # This likely needs GCS context
        if file_path in references:
            references.remove(file_path)
        return jsonify({'references': references, 'count': len(references)})
    except Exception as e:
        error_message = f"Error checking references in YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500
    finally:
        if local_temp_dir and os.path.exists(local_temp_dir):
            try:
                shutil.rmtree(local_temp_dir)
            except Exception as cleanup_error:
                 print(f"Error cleaning up local temp dir {local_temp_dir}: {cleanup_error}")

# Removed copy_referenced_files function as it's GCS specific now and handled differently

@yaml_bp.route('/upload', methods=['POST'])
def upload():
    """
    Upload a single YAML file and process it.

    Request body:
        file: YAML file to upload

    Returns:
        JSON object containing the processed config and the uploadId.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    upload_id = str(uuid.uuid4())
    original_filename = secure_filename(file.filename)

    local_temp_dir = None
    local_file_path = None
    try:
        # Save file temporarily
        local_temp_dir = tempfile.mkdtemp()
        local_file_path = os.path.join(local_temp_dir, original_filename)
        file.save(local_file_path)

        # Copy file to upload directory
        copy_file_to_upload(local_file_path, upload_id, original_filename)
        print(f"Saved main file for upload {upload_id}: {original_filename}")

        # Process the YAML file
        config = process_yaml_file(upload_id=upload_id, relative_path=original_filename)

        # Check for embedded errors
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
            for module_name, module_data in config['modules'].items():
                 if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                      processing_errors.append({
                          'module': module_name,
                          'error': module_data['config']['error']
                      })
        if processing_errors:
            print(f"Found errors during processing: {processing_errors}")
            # Clean up on error
            delete_upload_directory(upload_id)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422

        # Return config and the upload ID
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    except Exception as e:
        error_message = f"Error processing single YAML upload: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        # Clean up on error
        try:
            delete_upload_directory(upload_id)
        except:
            pass
        return jsonify({'error': error_message}), 500
    finally:
        # Clean up local temporary directory
        if local_temp_dir and os.path.exists(local_temp_dir):
            try:
                shutil.rmtree(local_temp_dir)
            except Exception as cleanup_error:
                print(f"Error cleaning up local temp dir {local_temp_dir}: {cleanup_error}")


@yaml_bp.route('/upload-folder', methods=['POST'])
def upload_folder():
    """
    Upload a folder (zip), extract locally, copy to upload directory, process main file.

    Request body:
        zip_file: Zip file containing YAML files
        main_file: Path to the main YAML file within the zip file

    Returns:
        JSON object containing the processed config and the uploadId.
    """
    if 'zip_file' not in request.files:
        return jsonify({'error': 'No zip file provided'}), 400
    zip_file_storage = request.files['zip_file']
    if zip_file_storage.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    main_file_relative = request.form.get('main_file', '')
    if not main_file_relative:
        return jsonify({'error': 'No main file specified'}), 400

    upload_id = str(uuid.uuid4())
    local_extract_dir = None

    try:
        # Create a temporary directory for local extraction
        local_extract_dir = tempfile.mkdtemp()
        print(f"Extracting zip file locally to: {local_extract_dir}")

        # Extract the zip file locally
        with zipfile.ZipFile(zip_file_storage, 'r') as zip_ref:
            zip_ref.extractall(local_extract_dir)

        # Check if main file exists locally after extraction
        local_main_file_path = os.path.join(local_extract_dir, main_file_relative)
        if not os.path.exists(local_main_file_path):
            return jsonify({'error': f'Main file not found in zip: {main_file_relative}'}), 400

        # Copy all extracted files to upload directory
        print(f"Copying extracted files to upload directory: {upload_id}")
        for root, _, files in os.walk(local_extract_dir):
            for filename in files:
                local_path = os.path.join(root, filename)
                # Calculate relative path within the extracted structure
                relative_path = os.path.relpath(local_path, local_extract_dir)
                copy_file_to_upload(local_path, upload_id, relative_path)

        print(f"Processing main YAML file: {main_file_relative}")
        config = process_yaml_file(upload_id=upload_id, relative_path=main_file_relative)

        # Check for embedded errors
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
             for module_name, module_data in config['modules'].items():
                  if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                       processing_errors.append({
                           'module': module_name,
                           'error': module_data['config']['error']
                       })
        if processing_errors:
            print(f"Found errors during processing: {processing_errors}")
            # Clean up on error
            delete_upload_directory(upload_id)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422

        # Return config and the upload ID
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    except Exception as e:
        error_message = f"Error processing YAML folder upload: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        # Clean up on error
        try:
            delete_upload_directory(upload_id)
        except:
            pass
        return jsonify({'error': error_message}), 500
    finally:
        # Clean up local extraction directory
        if local_extract_dir and os.path.exists(local_extract_dir):
            try:
                shutil.rmtree(local_extract_dir)
            except Exception as cleanup_error:
                print(f"Error cleaning up local extract dir {local_extract_dir}: {cleanup_error}")


@yaml_bp.route('/get-subgraph', methods=['POST'])
def get_subgraph():
    """
    Fetch and process a referenced YAML file using the upload context.

    Request body:
        uploadId: The unique ID for the upload session.
        relativePath: Relative path to the YAML file within the upload directory.
        moduleName: (Optional) Name of the module requesting the subgraph.
    """
    data = request.json
    upload_id = data.get('uploadId')
    relative_path = data.get('relativePath') # e.g., "block.yaml" or "inception/block.yaml"
    module_name = data.get('moduleName', 'ComposableModel') # Used for error reporting

    if not upload_id:
        return jsonify({'error': 'No uploadId provided'}), 400
    if not relative_path:
        return jsonify({'error': 'No relativePath provided'}), 400

    try:
        print(f"Processing subgraph request for uploadId: {upload_id}, path: {relative_path}")

        # Process the YAML file using the upload_id and relative path
        config = process_yaml_file(upload_id=upload_id, relative_path=relative_path)

        # Check for embedded errors (including file not found)
        processing_errors = []
        if isinstance(config, dict):
            if config.get('errorType') == 'CONFIG_FILE_NOT_FOUND_GCS' or config.get('errorType') == 'CONFIG_FILE_NOT_FOUND':
                 # Specific error from processing
                 return jsonify({
                     'error': config.get('error', f'Subgraph file not found: {relative_path}'),
                     'errorType': 'CONFIG_FILE_NOT_FOUND', # Keep consistent for frontend
                     'configPath': relative_path,
                     'moduleName': module_name
                 }), 404
            elif 'modules' in config:
                 # Check for errors within modules after processing
                 for mod_name, module_data in config['modules'].items():
                      if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                           processing_errors.append({
                               'module': mod_name,
                               'error': module_data['config']['error']
                           })

        if processing_errors:
             print(f"Found errors during subgraph processing: {processing_errors}")
             return jsonify({'error': 'Errors occurred during subgraph YAML processing.', 'details': processing_errors}), 422

        return jsonify(config) # Return 200 OK

    except FileNotFoundError: # Catch specific error if process_yaml_file raises it for GCS not found
         print(f"Error: File not found in GCS for uploadId: {upload_id}, path: {relative_path}")
         return jsonify({
             'error': f'Subgraph file not found: {relative_path}',
             'errorType': 'CONFIG_FILE_NOT_FOUND',
             'configPath': relative_path,
             'moduleName': module_name
         }), 404
    except Exception as e:
        error_message = f"Error processing subgraph file '{relative_path}' for upload {upload_id}: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        return jsonify({'error': error_message}), 500


# /fetch remains for external URLs, no GCS context needed
@yaml_bp.route('/fetch', methods=['POST'])
def fetch():
    """
    Fetch a YAML file from a URL and process it.
    """
    data = request.json
    if not data or 'url' not in data:
        return jsonify({'error': 'No URL provided'}), 400
    try:
        print(f"Fetching YAML file from URL: {data['url']}")
        # fetch_yaml_file might also need adaptation if it resolves internal references
        # Assuming it's only for self-contained external files for now
        config = fetch_yaml_file(data['url'])
        return jsonify(config)
    except Exception as e:
        error_message = f"Error fetching YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/crop-image', methods=['POST', 'OPTIONS'])
def crop_image_endpoint():
    """
    Crop an image to remove excess whitespace.
    
    Request body:
        image_data: Base64-encoded image data or data URL
        format: 'svg' or 'png' or 'auto' (default)
        padding: Optional padding in pixels (default: 20)
        
    Returns:
        The cropped image file for download
    """
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST')
        return response
        
    data = request.json
    if not data or 'image_data' not in data:
        return jsonify({'error': 'No image data provided'}), 400
        
    image_data = data['image_data']
    image_format = data.get('format', 'auto').lower()
    padding = data.get('padding', 20)
    
    if image_format not in ['svg', 'png', 'auto']:
        return jsonify({'error': 'Invalid format. Must be "svg", "png", or "auto"'}), 400
    
    try:
        print(f"Processing image crop request with format: {image_format}, padding: {padding}")
        
        # Crop the image using the service function
        cropped_data, content_type = crop_image(image_data, image_format, padding)
        
        # Return the cropped image with appropriate headers
        response = make_response(cropped_data)
        response.headers.set('Content-Type', content_type)
        response.headers.set('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        error_message = f"Error cropping image: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/list-presets', methods=['GET'])
def list_presets():
    """
    List all available pre-uploaded configurations from the local presets directory.
    
    Returns:
        JSON object containing the list of available presets (subfolder names).
    """
    try:
        preset_list = []
        if os.path.exists(LOCAL_PRESETS_DIR):
            # List directories in LOCAL_PRESETS_DIR that contain model.yaml
            for item in os.listdir(LOCAL_PRESETS_DIR):
                item_path = os.path.join(LOCAL_PRESETS_DIR, item)
                if os.path.isdir(item_path):
                    # Check if it contains model.yaml
                    model_yaml = os.path.join(item_path, 'model.yaml')
                    if os.path.exists(model_yaml):
                        preset_list.append(item)
        
        preset_list = sorted(preset_list)
        print(f"Found {len(preset_list)} presets: {preset_list}")
        
        # Return the list of presets
        response = make_response(jsonify({'presets': preset_list}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        error_message = f"Error listing presets: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"ERROR: {error_message}\nTraceback:\n{tb_str}")
        response = make_response(jsonify({'error': error_message}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@yaml_bp.route('/load-preset', methods=['POST'])
def load_preset():
    """
    Load a pre-uploaded configuration from the local presets directory.
    
    Request body:
        presetName: The name of the preset to load (subfolder name)
    
    Returns:
        JSON object containing the processed config and the uploadId.
    """
    data = request.json
    if not data or 'presetName' not in data:
        return jsonify({'error': 'No preset name provided'}), 400
    
    preset_name = data['presetName']
    
    try:
        print(f"Loading preset '{preset_name}'")
        
        # Generate a new upload ID for this preset
        upload_id = str(uuid.uuid4())
        
        # Check if preset directory exists
        preset_dir = os.path.join(LOCAL_PRESETS_DIR, preset_name)
        if not os.path.exists(preset_dir):
            return jsonify({'error': f"Preset '{preset_name}' not found"}), 404
        
        # Find the main file (model.yaml or first .yaml file)
        main_file = None
        if os.path.exists(os.path.join(preset_dir, 'model.yaml')):
            main_file = 'model.yaml'
        elif os.path.exists(os.path.join(preset_dir, 'main.yaml')):
            main_file = 'main.yaml'
        else:
            # Look for any .yaml or .yml file
            for item in os.listdir(preset_dir):
                if item.endswith('.yaml') or item.endswith('.yml'):
                    main_file = item
                    break
        
        if not main_file:
            return jsonify({'error': f"No YAML files found in preset '{preset_name}'"}), 404
        
        # Copy all files from preset directory to upload directory
        for root, _, files in os.walk(preset_dir):
            for filename in files:
                source_file = os.path.join(root, filename)
                rel_path = os.path.relpath(source_file, preset_dir)
                copy_file_to_upload(source_file, upload_id, rel_path)
        
        # Process the main YAML file
        print(f"Processing main file: {main_file}")
        config = process_yaml_file(upload_id=upload_id, relative_path=main_file)
        
        # Check for embedded errors
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
            for module_name, module_data in config['modules'].items():
                if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                    processing_errors.append({
                        'module': module_name,
                        'error': module_data['config']['error']
                    })
        if processing_errors:
            print(f"Found errors during processing: {processing_errors}")
            delete_upload_directory(upload_id)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422
        
        # Return config and the upload ID
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except Exception as e:
        error_message = f"Error loading preset '{preset_name}': {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        return jsonify({'error': error_message}), 500
