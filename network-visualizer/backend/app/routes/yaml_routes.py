from flask import Blueprint, request, jsonify, make_response # Import make_response
from werkzeug.utils import secure_filename
import os
import tempfile # Still needed for local extraction before GCS upload
import traceback
import shutil
import zipfile
import io
import glob # May still be useful for local temp processing
import yaml
import uuid # For generating unique upload IDs
import base64 # For image data processing
from google.cloud import storage # Import GCS client

from ..services.yaml_service import (
    parse_yaml_content,
    process_yaml_file, # This function will need significant changes
    fetch_yaml_file,
    find_all_config_references, # This might need GCS adaptation
    find_config_references # This might need GCS adaptation
)

from ..services.image_service import crop_image

# --- GCS Configuration ---
# Get bucket name from environment variable
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')
if not GCS_BUCKET_NAME:
    print("WARNING: GCS_BUCKET_NAME environment variable not set.")
    # Optionally, raise an error or use a default for local dev?
    # raise ValueError("GCS_BUCKET_NAME environment variable is required.")

# Define the path for pre-uploaded configurations
PRESETS_PATH = os.environ.get('PRESETS_PATH', 'presets/')

# Define a temporary directory for file uploads
TEMP_UPLOAD_DIR = os.environ.get('TEMP_UPLOAD_DIR', '/tmp/yaml_uploads')
# Ensure the directory exists
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

# Initialize GCS client (consider initializing within create_app or using Flask-Executor for background tasks)
# For simplicity here, initialize globally. Ensure credentials are set up in the environment (e.g., GOOGLE_APPLICATION_CREDENTIALS).
try:
    storage_client = storage.Client()
    gcs_bucket = storage_client.bucket(GCS_BUCKET_NAME) if GCS_BUCKET_NAME else None
except Exception as e:
    print(f"ERROR: Failed to initialize GCS client: {e}")
    storage_client = None
    gcs_bucket = None
# --- End GCS Configuration ---

# Create a blueprint for YAML routes
yaml_bp = Blueprint('yaml', __name__, url_prefix='/api/yaml')

# --- Helper Function for GCS Upload ---
def upload_to_gcs(local_file_path, gcs_blob_name):
    """Uploads a file to the GCS bucket."""
    if not gcs_bucket:
        raise ConnectionError("GCS bucket not initialized.")
    try:
        blob = gcs_bucket.blob(gcs_blob_name)
        blob.upload_from_filename(local_file_path)
        print(f"File {local_file_path} uploaded to gs://{GCS_BUCKET_NAME}/{gcs_blob_name}.")
        return f"gs://{GCS_BUCKET_NAME}/{gcs_blob_name}" # Return the GCS URI
    except Exception as e:
        print(f"ERROR: Failed to upload {local_file_path} to GCS: {e}")
        raise

# --- Helper Function for GCS Cleanup ---
def delete_gcs_prefix(prefix):
    """Deletes all blobs in the GCS bucket with the given prefix."""
    if not gcs_bucket:
        print("WARNING: GCS bucket not initialized. Cannot delete prefix.")
        return
    try:
        blobs = storage_client.list_blobs(GCS_BUCKET_NAME, prefix=prefix)
        count = 0
        for blob in blobs:
            blob.delete()
            count += 1
        print(f"Deleted {count} blobs with prefix '{prefix}' from GCS bucket '{GCS_BUCKET_NAME}'.")
    except Exception as e:
        print(f"ERROR: Failed to delete GCS prefix '{prefix}': {e}")
        # Don't raise, just log the error for cleanup

# --- Helper Function for Local Temp Directory Cleanup ---
def cleanup_temp_directory():
    """
    Cleans up the local temporary directory by removing all files in it.
    This function is designed to be safe and not raise exceptions.
    """
    try:
        # In Cloud Run, we should use a directory that's definitely writable
        # /tmp is generally available in most container environments
        if os.path.exists(TEMP_UPLOAD_DIR):
            print(f"Attempting to clean up temporary directory: {TEMP_UPLOAD_DIR}")
            try:
                # Check if we have write permissions by creating a test file
                test_file = os.path.join(TEMP_UPLOAD_DIR, '.test_write_permission')
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
                
                # If we get here, we have write permissions
                # Remove all files and subdirectories in the temp directory
                for item in os.listdir(TEMP_UPLOAD_DIR):
                    item_path = os.path.join(TEMP_UPLOAD_DIR, item)
                    try:
                        if os.path.isfile(item_path):
                            os.unlink(item_path)
                        elif os.path.isdir(item_path):
                            shutil.rmtree(item_path)
                    except Exception as item_error:
                        print(f"WARNING: Could not remove {item_path}: {item_error}")
                        # Continue with other files even if one fails
                        continue
                print(f"Successfully cleaned up temporary directory: {TEMP_UPLOAD_DIR}")
            except Exception as perm_error:
                print(f"WARNING: No write permission for {TEMP_UPLOAD_DIR}: {perm_error}")
                # Don't try to create or clean if we don't have permissions
        else:
            # Create the directory if it doesn't exist
            try:
                os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)
                print(f"Created temporary directory: {TEMP_UPLOAD_DIR}")
            except Exception as mkdir_error:
                print(f"WARNING: Could not create directory {TEMP_UPLOAD_DIR}: {mkdir_error}")
                # If we can't create the directory, we'll use tempfile.mkdtemp() later
    except Exception as e:
        print(f"WARNING: Failed to clean up temporary directory {TEMP_UPLOAD_DIR}: {e}")
        # Don't raise, just log the warning

# --- Modified Routes ---

# Renamed from /cleanup-temp
@yaml_bp.route('/cleanup-upload', methods=['POST'])
def cleanup_upload():
    """
    Clean up the GCS objects associated with a specific upload ID.
    Request body:
        uploadId: The unique ID for the upload session.
    """
    data = request.json
    upload_id = data.get('uploadId')

    if not upload_id:
        return jsonify({'error': 'No uploadId provided'}), 400

    if not gcs_bucket:
         return jsonify({'error': 'GCS not configured on server'}), 500

    gcs_prefix = f"uploads/{upload_id}/"
    try:
        delete_gcs_prefix(gcs_prefix)
        return jsonify({'message': f'Upload context {upload_id} cleaned up successfully'}), 200
    except Exception as e:
        error_message = f"Error cleaning up GCS upload context {upload_id}: {str(e)}"
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
    Upload a single YAML file to GCS and process it.

    Request body:
        file: YAML file to upload

    Returns:
        JSON object containing the processed config and the uploadId.
    """
    # Try to clean up the temporary directory before processing a new upload
    # But don't fail if cleanup fails
    try:
        cleanup_temp_directory()
    except Exception as e:
        print(f"WARNING: Temp directory cleanup failed but continuing: {e}")
    
    if not gcs_bucket:
         return jsonify({'error': 'GCS not configured on server'}), 500
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    upload_id = str(uuid.uuid4())
    gcs_prefix = f"uploads/{upload_id}/"
    original_filename = secure_filename(file.filename)
    gcs_blob_name = f"{gcs_prefix}{original_filename}"

    local_temp_dir = None
    local_file_path = None
    try:
        # Save locally temporarily to upload to GCS
        local_temp_dir = tempfile.mkdtemp()
        local_file_path = os.path.join(local_temp_dir, original_filename)
        file.save(local_file_path)

        # Upload the main file to GCS
        gcs_uri = upload_to_gcs(local_file_path, gcs_blob_name)
        print(f"Uploaded main file to: {gcs_uri}")

        # Process the YAML file using its GCS path/upload_id
        # process_yaml_file needs to be adapted for GCS
        # It should accept upload_id and the relative path (original_filename here)
        config = process_yaml_file(upload_id=upload_id, relative_path=original_filename)

        # Check for embedded errors (assuming process_yaml_file returns them similarly)
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
            # Clean up GCS on error
            delete_gcs_prefix(gcs_prefix)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422

        # Return config and the upload ID with CORS header
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = 'https://network-visualizer-36300.web.app' # Or '*' for testing, but specific is better
        return response

    except Exception as e:
        error_message = f"Error processing single YAML upload: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        # Clean up GCS on error
        delete_gcs_prefix(gcs_prefix)
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
    Upload a folder (zip), extract locally, upload contents to GCS, process main file.

    Request body:
        zip_file: Zip file containing YAML files
        main_file: Path to the main YAML file within the zip file

    Returns:
        JSON object containing the processed config and the uploadId.
    """
    # Try to clean up the temporary directory before processing a new upload
    # But don't fail if cleanup fails
    try:
        cleanup_temp_directory()
    except Exception as e:
        print(f"WARNING: Temp directory cleanup failed but continuing: {e}")
    
    if not gcs_bucket:
         return jsonify({'error': 'GCS not configured on server'}), 500
    if 'zip_file' not in request.files:
        return jsonify({'error': 'No zip file provided'}), 400
    zip_file_storage = request.files['zip_file']
    if zip_file_storage.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    main_file_relative = request.form.get('main_file', '')
    if not main_file_relative:
        return jsonify({'error': 'No main file specified'}), 400

    upload_id = str(uuid.uuid4())
    gcs_prefix = f"uploads/{upload_id}/"
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

        # Upload all extracted files to GCS under the upload_id prefix
        print(f"Uploading extracted files to GCS prefix: {gcs_prefix}")
        for root, _, files in os.walk(local_extract_dir):
            for filename in files:
                local_path = os.path.join(root, filename)
                # Calculate relative path within the extracted structure
                relative_path = os.path.relpath(local_path, local_extract_dir)
                gcs_blob_name = f"{gcs_prefix}{relative_path}"
                upload_to_gcs(local_path, gcs_blob_name)

        print(f"Processing main YAML file via GCS context: {main_file_relative}")
        # Process the main YAML file using the upload_id and its relative path
        # process_yaml_file needs adaptation for GCS
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
            # Clean up GCS on error
            delete_gcs_prefix(gcs_prefix)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422

        # Return config and the upload ID with CORS header
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = 'https://network-visualizer-36300.web.app' # Or '*' for testing, but specific is better
        return response

    except Exception as e:
        error_message = f"Error processing YAML folder upload: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        # Clean up GCS on error
        delete_gcs_prefix(gcs_prefix)
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
    Fetch and process a referenced YAML file from GCS using the upload context.

    Request body:
        uploadId: The unique ID for the upload session.
        relativePath: Relative path to the YAML file within the GCS upload prefix.
        moduleName: (Optional) Name of the module requesting the subgraph.
    """
    if not gcs_bucket:
         return jsonify({'error': 'GCS not configured on server'}), 500

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
        # process_yaml_file needs adaptation for GCS
        config = process_yaml_file(upload_id=upload_id, relative_path=relative_path)

        # Check for embedded errors (including file not found within GCS context)
        processing_errors = []
        if isinstance(config, dict):
            if config.get('errorType') == 'CONFIG_FILE_NOT_FOUND_GCS':
                 # Specific error from GCS processing
                 return jsonify({
                     'error': config.get('error', f'Subgraph file not found in GCS: {relative_path}'),
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
        response.headers.add('Access-Control-Allow-Origin', 'https://network-visualizer-36300.web.app')
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
        response.headers.set('Access-Control-Allow-Origin', 'https://network-visualizer-36300.web.app')
        return response
        
    except Exception as e:
        error_message = f"Error cropping image: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        return jsonify({'error': error_message}), 500

@yaml_bp.route('/list-presets', methods=['GET'])
def list_presets():
    """
    List all available pre-uploaded configurations from the GCS bucket.
    
    Returns:
        JSON object containing the list of available presets (subfolder names).
    """
    if not gcs_bucket:
        print("ERROR: GCS bucket not configured. Check GCS_BUCKET_NAME environment variable.")
        return jsonify({'error': 'GCS not configured on server'}), 500
    
    try:
        print("=" * 80)
        print("DETAILED PRESET LISTING DEBUG INFO")
        print("=" * 80)
        print(f"DEBUG: Full GCS path being searched: gs://{GCS_BUCKET_NAME}/{PRESETS_PATH}")
        print(f"DEBUG: Bucket name: {GCS_BUCKET_NAME}")
        print(f"DEBUG: Preset path prefix: {PRESETS_PATH}")
        
        # List all blobs under the presets path (no delimiter)
        print(f"DEBUG: Listing all blobs under prefix '{PRESETS_PATH}' to find model.yaml files:")
        all_blobs = list(storage_client.list_blobs(GCS_BUCKET_NAME, prefix=PRESETS_PATH))
        print(f"DEBUG: Found {len(all_blobs)} total blobs under prefix.")

        # Get unique parent folder names containing 'model.yaml'
        prefixes = set()
        for blob in all_blobs:
            print(f"DEBUG: Checking blob: {blob.name}")
            # Check if the blob is named 'model.yaml' and is inside a subfolder of PRESETS_PATH
            if blob.name.endswith('/model.yaml') and blob.name != PRESETS_PATH + 'model.yaml':
                # Extract the path part before '/model.yaml'
                path_part = blob.name[:-len('/model.yaml')] # e.g., "presets/GoogLeNet"
                print(f"DEBUG: Found model.yaml at: {blob.name}, path part: {path_part}")
                # Ensure it's under the PRESETS_PATH
                if path_part.startswith(PRESETS_PATH):
                    # Get the relative path from PRESETS_PATH
                    relative_folder_path = path_part[len(PRESETS_PATH):] # e.g., "GoogLeNet"
                    # Get the top-level folder name
                    folder_name = relative_folder_path.split('/')[0]
                    if folder_name: # Ensure it's not empty
                        print(f"DEBUG: Extracted preset folder name: '{folder_name}'")
                        prefixes.add(folder_name)
                    else:
                         print(f"DEBUG: Skipping blob {blob.name}, couldn't extract valid folder name.")
                else:
                     print(f"DEBUG: Skipping blob {blob.name}, path part doesn't start with {PRESETS_PATH}")
            else:
                 print(f"DEBUG: Skipping blob {blob.name}, not a model.yaml in a subfolder.")
        
        # Convert to sorted list
        preset_list = sorted(list(prefixes))
        
        print(f"DEBUG: Found {len(preset_list)} presets: {preset_list}")
        
        # Return the list of presets with CORS header
        response = make_response(jsonify({'presets': preset_list}))
        # Allow requests from any origin during development/debugging
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        error_message = f"Error listing presets: {str(e)}"
        tb_str = traceback.format_exc()
        print(f"ERROR: {error_message}\nTraceback:\n{tb_str}")
        
        # Return error with CORS header and more detailed information
        response = make_response(jsonify({
            'error': error_message,
            'details': {
                'bucket': GCS_BUCKET_NAME,
                'presets_path': PRESETS_PATH,
                'traceback': tb_str
            }
        }))
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 500

@yaml_bp.route('/load-preset', methods=['POST'])
def load_preset():
    """
    Load a pre-uploaded configuration from the GCS bucket.
    
    Request body:
        presetName: The name of the preset to load (subfolder name or file name without extension)
    
    Returns:
        JSON object containing the processed config and the uploadId.
    """
    if not gcs_bucket:
        return jsonify({'error': 'GCS not configured on server'}), 500
    
    data = request.json
    if not data or 'presetName' not in data:
        return jsonify({'error': 'No preset name provided'}), 400
    
    preset_name = data['presetName']
    
    try:
        print(f"DEBUG: Loading preset '{preset_name}'")
        
        # Generate a new upload ID for this preset
        upload_id = str(uuid.uuid4())
        gcs_prefix = f"uploads/{upload_id}/"
        
        # First check if this is a direct YAML file
        direct_yaml_path = f"{PRESETS_PATH}{preset_name}.yaml"
        direct_yml_path = f"{PRESETS_PATH}{preset_name}.yml"
        
        # Check if the preset is a direct YAML file
        direct_yaml_blob = None
        try:
            direct_yaml_blob = gcs_bucket.blob(direct_yaml_path)
            if direct_yaml_blob.exists():
                print(f"DEBUG: Found direct YAML file: {direct_yaml_path}")
                main_file = f"{preset_name}.yaml"
                
                # Copy the YAML file to the uploads location
                new_blob_name = f"{gcs_prefix}{preset_name}.yaml"
                new_blob = gcs_bucket.blob(new_blob_name)
                
                # Copy the blob
                token = None
                rewrite_token = None
                while True:
                    token, rewrite_token, bytes_rewritten = new_blob.rewrite(
                        source=direct_yaml_blob, token=rewrite_token
                    )
                    if token is None:
                        break
                
                print(f"DEBUG: Copied {direct_yaml_path} to {new_blob_name}")
                
                # Process the YAML file
                print(f"DEBUG: Processing direct YAML file: {preset_name}.yaml")
                config = process_yaml_file(upload_id=upload_id, relative_path=f"{preset_name}.yaml")
                
                # Return config and the upload ID with CORS header
                response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
                response.headers['Access-Control-Allow-Origin'] = 'https://network-visualizer-36300.web.app'
                return response
        except Exception as e:
            print(f"DEBUG: Error checking for direct YAML file: {e}")
            # Continue to check for folder
        
        # If not a direct file, check for .yml extension
        try:
            direct_yml_blob = gcs_bucket.blob(direct_yml_path)
            if direct_yml_blob.exists():
                print(f"DEBUG: Found direct YML file: {direct_yml_path}")
                main_file = f"{preset_name}.yml"
                
                # Copy the YAML file to the uploads location
                new_blob_name = f"{gcs_prefix}{preset_name}.yml"
                new_blob = gcs_bucket.blob(new_blob_name)
                
                # Copy the blob
                token = None
                rewrite_token = None
                while True:
                    token, rewrite_token, bytes_rewritten = new_blob.rewrite(
                        source=direct_yml_blob, token=rewrite_token
                    )
                    if token is None:
                        break
                
                print(f"DEBUG: Copied {direct_yml_path} to {new_blob_name}")
                
                # Process the YAML file
                print(f"DEBUG: Processing direct YML file: {preset_name}.yml")
                config = process_yaml_file(upload_id=upload_id, relative_path=f"{preset_name}.yml")
                
                # Return config and the upload ID with CORS header
                response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
                response.headers['Access-Control-Allow-Origin'] = 'https://network-visualizer-36300.web.app'
                return response
        except Exception as e:
            print(f"DEBUG: Error checking for direct YML file: {e}")
            # Continue to check for folder
        
        # If not a direct file, check for folder
        preset_path = f"{PRESETS_PATH}{preset_name}/"
        main_file = "model.yaml"  # Default main file name
        
        print(f"DEBUG: Checking for folder at path: {preset_path}")
        
        # Check if the preset exists as a folder
        blobs = list(storage_client.list_blobs(GCS_BUCKET_NAME, prefix=preset_path))
        if not blobs:
            print(f"DEBUG: No blobs found with prefix '{preset_path}'")
            return jsonify({'error': f"Preset '{preset_name}' not found as file or folder"}), 404
        
        print(f"DEBUG: Found {len(blobs)} blobs in preset folder '{preset_name}'")
        for blob in blobs:
            print(f"DEBUG: Found blob: {blob.name}")
        
        # Find the main file
        main_file_blob = None
        for blob in blobs:
            if blob.name.endswith('/model.yaml') or blob.name.endswith('/main.yaml'):
                main_file_blob = blob
                main_file = blob.name[len(preset_path):]  # Get relative path
                print(f"DEBUG: Found main file: {main_file}")
                break
        
        if not main_file_blob:
            # If no model.yaml or main.yaml found, look for any .yaml file
            for blob in blobs:
                if blob.name.endswith('.yaml') or blob.name.endswith('.yml'):
                    main_file_blob = blob
                    main_file = blob.name[len(preset_path):]  # Get relative path
                    print(f"DEBUG: Using {main_file} as main file")
                    break
        
        if not main_file_blob:
            print(f"DEBUG: No YAML files found in preset folder '{preset_name}'")
            return jsonify({'error': f"No YAML files found in preset folder '{preset_name}'"}), 404
        
        print(f"DEBUG: Generated upload ID: {upload_id}")
        
        # Copy each blob to the new upload location
        for blob in blobs:
            # Get the relative path within the preset folder
            relative_path = blob.name[len(preset_path):]
            if not relative_path:  # Skip the folder itself
                continue
                
            # Create a new blob in the uploads location
            new_blob_name = f"{gcs_prefix}{relative_path}"
            new_blob = gcs_bucket.blob(new_blob_name)
            
            # Copy the blob
            token = None
            rewrite_token = None
            while True:
                token, rewrite_token, bytes_rewritten = new_blob.rewrite(
                    source=blob, token=rewrite_token
                )
                if token is None:
                    break
            
            print(f"DEBUG: Copied {blob.name} to {new_blob_name}")
        
        # Process the main YAML file
        print(f"DEBUG: Processing main file: {main_file}")
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
            # Clean up GCS on error
            delete_gcs_prefix(gcs_prefix)
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422
        
        # Return config and the upload ID with CORS header
        response = make_response(jsonify({'config': config, 'uploadId': upload_id}))
        response.headers['Access-Control-Allow-Origin'] = 'https://network-visualizer-36300.web.app'
        return response
        
    except Exception as e:
        error_message = f"Error loading preset '{preset_name}': {str(e)}"
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        return jsonify({'error': error_message}), 500
