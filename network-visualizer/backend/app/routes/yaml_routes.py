from flask import Blueprint, request, jsonify, session # Import session
from werkzeug.utils import secure_filename
import os
import tempfile
import traceback # Import traceback
import shutil
import zipfile
import io
import glob # Added for file searching
import yaml # Import yaml for parsing

from ..services.yaml_service import (
    parse_yaml_content,
    process_yaml_file, # Ensure this is imported
    fetch_yaml_file,
    find_all_config_references,
    find_config_references # Import find_config_references
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
        # Parse the YAML content (no root_temp_dir context here)
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

    file_path = None # Initialize file_path to ensure it's defined in finally
    try:
        # Save the file to a temporary location
        filename = secure_filename(file.filename)
        temp_dir = tempfile.gettempdir() # Use system default temp dir
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
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as cleanup_error:
                 print(f"Error cleaning up temp file {file_path}: {cleanup_error}")


def copy_referenced_files(file_path, temp_dir, project_root=None):
    """
    Find all referenced files in a YAML file and copy them to the temporary directory.
    
    Args:
        file_path: Path to the YAML file
        temp_dir: Temporary directory to copy files to
        project_root: Root directory of the project to search for referenced files
        
    Returns:
        List of files that couldn't be found
    """
    try:
        # Get the base path for resolving relative paths
        base_path = os.path.dirname(file_path)
        
        # Read the YAML file
        with open(file_path, 'r') as f:
            content = f.read()
            
        # Parse the YAML content
        config = yaml.safe_load(content)
        
        # Find all referenced files
        references = find_config_references(config, base_path)
        
        missing_files = []
        
        # Copy each referenced file to the temporary directory
        for module_name, ref_path in references:
            # Get the relative path from the reference
            if os.path.exists(ref_path):
                # Determine the relative path within the project
                if project_root and ref_path.startswith(project_root):
                    rel_path = os.path.relpath(ref_path, project_root)
                else:
                    # If we can't determine a clean relative path, use the filename
                    rel_path = os.path.basename(ref_path)
                
                # Create the target directory in the temp dir
                target_dir = os.path.dirname(os.path.join(temp_dir, rel_path))
                os.makedirs(target_dir, exist_ok=True)
                
                # Copy the file
                target_path = os.path.join(temp_dir, rel_path)
                shutil.copy2(ref_path, target_path)
                print(f"Copied referenced file: {ref_path} -> {target_path}")
                
                # Recursively copy referenced files from this file
                nested_missing = copy_referenced_files(target_path, temp_dir, project_root)
                missing_files.extend(nested_missing)
            else:
                print(f"Warning: Referenced file not found: {ref_path}")
                missing_files.append((module_name, ref_path))
                
        return missing_files
    except Exception as e:
        print(f"Error copying referenced files: {e}")
        return []

@yaml_bp.route('/upload', methods=['POST'])
def upload():
    """
    Upload and process a YAML file with improved handling of references.

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
    auto_upload_references = request.form.get('auto_upload_references', 'true').lower() == 'true'

    temp_dir = None  # Initialize temp_dir
    file_path = None  # Initialize file_path
    try:
        # Create a temporary directory for this upload
        temp_dir = tempfile.mkdtemp()
        print(f"Created temporary directory for upload: {temp_dir}")
        
        # Get the original filename
        original_filename = secure_filename(file.filename)
        
        # Save the file to the temporary directory
        file_path = os.path.join(temp_dir, original_filename)
        file.save(file_path)
        print(f"Saved uploaded file to: {file_path}")
        
        # If auto_upload_references is enabled, try to find and copy referenced files
        missing_references = []
        if auto_upload_references:
            # Try to find the project root directory
            project_root = os.getcwd()  # Default to current working directory
            
            # Look for the file in the project directory
            for root, dirs, files in os.walk(project_root):
                for name in files:
                    if name == original_filename:
                        found_path = os.path.join(root, name)
                        # If we found the file in the project, use its directory as base
                        if os.path.exists(found_path):
                            print(f"Found matching file in project: {found_path}")
                            # Copy referenced files
                            missing_references = copy_referenced_files(file_path, temp_dir, project_root)
                            break
                if missing_references:  # Break outer loop if we've processed references
                    break
        
        print(f"Processing uploaded YAML file: {file_path}")
        
        # Process the YAML file with the temp_dir as root_temp_dir
        config = process_yaml_file(file_path, root_temp_dir=temp_dir)
        
        # Check for embedded errors
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
            for module_name, module_data in config['modules'].items():
                if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                    processing_errors.append({
                        'module': module_name,
                        'error': module_data['config']['error']
                    })
        
        # Add missing references to processing errors
        for module_name, ref_path in missing_references:
            processing_errors.append({
                'module': module_name,
                'error': f"Referenced file not found: {ref_path}"
            })
        
        if processing_errors:
            print(f"Found errors during processing: {processing_errors}")
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422
        
        # Store the temp directory in the session for future reference
        print(f"Attempting to set session['upload_temp_dir'] = {temp_dir}")
        session['upload_temp_dir'] = temp_dir
        print(f"Stored temp_dir in session after successful processing.")
        
        return jsonify(config)
    except Exception as e:
        error_message = f"Error processing YAML file: {str(e)}"
        # Log the full traceback for detailed debugging
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        
        # Clean up the temporary directory on error
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                print(f"Cleaned up temp_dir {temp_dir} after error.")
            except Exception as cleanup_error:
                print(f"Error cleaning up temp_dir {temp_dir} after error: {cleanup_error}")
        
        return jsonify({'error': error_message}), 500


@yaml_bp.route('/upload-folder', methods=['POST'])
def upload_folder():
    """
    Upload a folder of YAML files (as a zip file), process the main YAML file,
    and store the temporary directory context in the session.

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

    # Get the main file path relative to the zip root
    main_file = request.form.get('main_file', '')
    if main_file == '':
        return jsonify({'error': 'No main file specified'}), 400

    temp_dir = None # Initialize temp_dir
    try:
        # Create a temporary directory to extract the zip file
        temp_dir = tempfile.mkdtemp()

        print(f"Extracting zip file to: {temp_dir}")

        # Extract the zip file
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)

        # Get the full path to the main YAML file within the temp directory
        main_file_path = os.path.join(temp_dir, main_file)

        if not os.path.exists(main_file_path):
             # Clean up before returning error
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            return jsonify({'error': f'Main file not found: {main_file}'}), 400

        print(f"Processing main YAML file: {main_file_path}")

        # Process the main YAML file, passing temp_dir as root_temp_dir
        # This allows resolve_config_references to prioritize paths relative to temp_dir
        config = process_yaml_file(main_file_path, root_temp_dir=temp_dir)

        # Check for embedded errors from resolve_config_references
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
            for module_name, module_data in config['modules'].items():
                 if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                      processing_errors.append({
                          'module': module_name,
                          'error': module_data['config']['error']
                      })

        if processing_errors:
            print(f"Found errors during initial processing: {processing_errors}")
            # Clean up the temp directory as the upload is considered failed
            if temp_dir and os.path.exists(temp_dir):
                 try:
                     shutil.rmtree(temp_dir)
                     print(f"Cleaned up temp_dir {temp_dir} due to processing errors.")
                 except Exception as cleanup_error:
                     print(f"Error cleaning up temp_dir {temp_dir} after processing errors: {cleanup_error}")
            # Return a 422 error indicating processing issues
            return jsonify({'error': 'Errors occurred during YAML processing.', 'details': processing_errors}), 422

        # If no errors, store only the root temp directory path in the session
        print(f"Attempting to set session['upload_temp_dir'] = {temp_dir}")
        session['upload_temp_dir'] = temp_dir
        print(f"Stored temp_dir in session after successful processing.")

        return jsonify(config) # Return 200 OK

    except Exception as e:
        error_message = f"Error processing YAML folder: {str(e)}"
        # Log the full traceback for detailed debugging
        tb_str = traceback.format_exc()
        print(f"{error_message}\nTraceback:\n{tb_str}")
        # Ensure temp_dir exists before trying to clean up on error
        if temp_dir and os.path.exists(temp_dir):
             try:
                 shutil.rmtree(temp_dir)
                 print(f"Cleaned up temp_dir {temp_dir} after error.")
             except Exception as cleanup_error:
                 print(f"Error cleaning up temp_dir {temp_dir} after error: {cleanup_error}")
        return jsonify({'error': error_message}), 500
    # No finally block needed here as cleanup is handled on error or needs separate strategy for success


# Renamed from /fetch, now handles relative paths within the session's temp dir
@yaml_bp.route('/get-subgraph', methods=['POST'])
def get_subgraph():
    """
    Fetch and process a YAML file using a relative path within the
    temporary directory stored in the session.

    Request body:
        relativePath: Relative path to the YAML file within the temp upload directory.

    Returns:
        Parsed YAML configuration with resolved interpolations and config references.
    """
    data = request.json
    relative_path = data.get('relativePath') # e.g., "block.yaml" or "inception/block.yaml"

    if not relative_path:
        return jsonify({'error': 'No relativePath provided'}), 400

    # Retrieve the root temporary directory from the session
    print(f"Session contents on /get-subgraph entry: {dict(session)}")
    temp_dir = session.get('upload_temp_dir')

    # Check if temp_dir is valid
    if not temp_dir or not os.path.isdir(temp_dir):
         print(f"Error: upload_temp_dir '{temp_dir}' not found in session or is not a directory.")
         return jsonify({'error': 'No active upload context found or context is invalid. Please upload the folder again.'}), 400

    try:
        # --- IMPROVED FILE SEARCH LOGIC ---
        # 1. First try direct path (relative to temp_dir)
        direct_path = os.path.normpath(os.path.join(temp_dir, relative_path))
        
        # 2. If direct path doesn't exist, try to find the file by name anywhere in the temp_dir
        if os.path.exists(direct_path):
            found_path = direct_path
            print(f"Found file at direct path: {found_path}")
        else:
            # Extract just the filename from the relative path
            filename = os.path.basename(relative_path)
            
            # Use glob to find all files with this name in the temp_dir
            pattern = os.path.join(temp_dir, '**', filename)
            matching_files = glob.glob(pattern, recursive=True)
            
            print(f"Searching for '{filename}' in '{temp_dir}', found: {matching_files}")
            
            if not matching_files:
                print(f"Error: File '{filename}' not found anywhere in temp dir '{temp_dir}'")
                return jsonify({'error': f'Subgraph file not found: {relative_path}'}), 404
            
            if len(matching_files) > 1:
                print(f"Warning: Multiple files named '{filename}' found in temp dir. Using the first one: {matching_files[0]}")
            
            found_path = matching_files[0]
        
        # Security check: Ensure the found path is within the temp directory
        abs_temp_dir = os.path.abspath(temp_dir)
        if not os.path.abspath(found_path).startswith(abs_temp_dir + os.sep):
            print(f"Error: Found path '{found_path}' is outside temp dir '{abs_temp_dir}'.")
            return jsonify({'error': 'Invalid file path resolved.'}), 400
        
        print(f"Processing subgraph file: {found_path}")
        
        # Process the YAML file using the found path, passing temp_dir as root_temp_dir
        config = process_yaml_file(found_path, root_temp_dir=temp_dir)

        # Check for embedded errors from resolve_config_references
        processing_errors = []
        if isinstance(config, dict) and 'modules' in config:
            for module_name, module_data in config['modules'].items():
                 if isinstance(module_data, dict) and isinstance(module_data.get('config'), dict) and 'error' in module_data['config']:
                      processing_errors.append({
                          'module': module_name,
                          'error': module_data['config']['error']
                      })

        if processing_errors:
             print(f"Found errors during subgraph processing: {processing_errors}")
             # Return a 422 error indicating processing issues
             return jsonify({'error': 'Errors occurred during subgraph YAML processing.', 'details': processing_errors}), 422

        return jsonify(config) # Return 200 OK
    except Exception as e:
        error_message = f"Error processing subgraph file '{relative_path}': {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

# Keep the original /fetch route for potential external URL fetching if needed
# It might need adjustments based on how resolve_config_references handles non-file paths
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

        # Fetch and process the YAML file (root_temp_dir is None here)
        config = fetch_yaml_file(data['url'])

        return jsonify(config)
    except Exception as e:
        error_message = f"Error fetching YAML file: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500
