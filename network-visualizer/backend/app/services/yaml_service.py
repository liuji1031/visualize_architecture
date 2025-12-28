import os
import yaml
import requests
import tempfile # Still needed for local temp copies
import shutil
import traceback
from typing import Dict, Any, Optional, List, Tuple
from omegaconf import OmegaConf

# --- Local Storage Configuration ---
LOCAL_UPLOAD_DIR = os.environ.get('LOCAL_UPLOAD_DIR', os.path.join(tempfile.gettempdir(), 'yaml_uploads'))
# --- End Local Storage Configuration ---

def get_upload_file_path(upload_id: str, relative_path: str) -> str:
    """Get the full local file path for an upload file."""
    return os.path.join(LOCAL_UPLOAD_DIR, 'uploads', upload_id, relative_path)

def cleanup_local_temp_file(file_path: Optional[str]):
    """Safely removes a local temporary file if it exists."""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            # print(f"Cleaned up local temp file: {file_path}")
        except Exception as e:
            print(f"WARNING: Failed to clean up local temp file {file_path}: {e}")

# --- Modified Service Functions ---

# Modified signature: accepts upload_id instead of root_temp_dir
# base_path is now the relative directory *within* the GCS upload prefix
def parse_yaml_content(content: str, upload_id: Optional[str] = None, base_path: str = '') -> Dict[str, Any]:
    """
    Parse YAML content, resolve interpolations, and resolve config references using local storage.

    Args:
        content: YAML content as a string.
        upload_id: The unique ID for the upload context.
        base_path: The relative directory path within the upload directory for resolving relative references.

    Returns:
        Parsed YAML configuration with resolved interpolations and config references.
    """
    try:
        # Parse the YAML content using OmegaConf
        config = OmegaConf.create(yaml.safe_load(content))
        # Resolve interpolation expressions first
        resolved_config = OmegaConf.to_container(config, resolve=True)
    except Exception as e:
        print(f"Error parsing initial YAML content: {e}")
        return {'error': f"Invalid YAML content: {e}"}

    # Resolve config references using local storage
    try:
        return resolve_config_references(resolved_config, upload_id=upload_id, base_path=base_path)
    except Exception as e:
        print(f"Error resolving config references: {e}")
        # Return the partially resolved config but add an error marker
        resolved_config['_processing_error'] = f"Error resolving references: {e}"
        return resolved_config


# find_config_references and find_all_config_references are problematic with GCS
# without downloading everything first. They are less critical for the core processing logic
# which now resolves references on demand via GCS.
# Keep them for now but note their limitations in a GCS context.
def find_config_references(config: Dict[str, Any], base_path: str = '') -> List[Tuple[str, str]]:
    """
    Find all config fields that are strings pointing to YAML files (based on local paths).
    NOTE: This function operates on the assumption of local paths and may not accurately
          reflect GCS structure without adaptation or prior download of all files.
    """
    references = []
    if not config or 'modules' not in config:
        return references
    modules = config['modules']
    for module_name, module_data in modules.items():
        if module_name in ['input', 'output']: continue
        if isinstance(module_data, dict) and 'config' in module_data and isinstance(module_data['config'], str):
            config_path_str = module_data['config']
            # This resolution logic is local-filesystem based
            resolved_path = config_path_str
            if not config_path_str.startswith('/'):
                possible_paths = [os.path.join(base_path, config_path_str), config_path_str]
                for path in possible_paths:
                    if os.path.exists(path): # Checks local filesystem only
                        resolved_path = path
                        references.append((module_name, resolved_path))
                        break
            elif os.path.exists(resolved_path):
                 references.append((module_name, resolved_path))
    return references

def find_all_config_references(file_path: str) -> List[str]:
    """
    Recursively find all YAML files referenced (based on local paths).
    NOTE: This function operates on the assumption of local paths and may not accurately
          reflect GCS structure without adaptation or prior download of all files.
    """
    base_path = os.path.dirname(file_path)
    print(f"Finding all config references locally in: {file_path}")
    try:
        with open(file_path, 'r') as f: content = f.read()
        config = yaml.safe_load(content)
        references = find_config_references(config, base_path) # Uses local path logic
        all_references = [file_path]
        processed_paths = {file_path}
        queue = [ref_path for _, ref_path in references]
        while queue:
            current_ref_path = queue.pop(0)
            if current_ref_path in processed_paths: continue
            processed_paths.add(current_ref_path)
            if current_ref_path not in all_references: all_references.append(current_ref_path)
            try:
                # Recursive call assumes local file exists
                nested_references = find_all_config_references(current_ref_path)
                for nested_ref in nested_references:
                    if nested_ref not in processed_paths and nested_ref not in queue:
                        queue.append(nested_ref)
            except FileNotFoundError: print(f"Warning: Referenced file not found locally during recursive search: {current_ref_path}")
            except Exception as e: print(f"Error finding references locally in {current_ref_path}: {e}")
        return all_references
    except FileNotFoundError: print(f"Error: Initial file not found locally in find_all_config_references: {file_path}"); return [file_path]
    except Exception as e: print(f"Error reading/parsing initial file {file_path} locally in find_all_config_references: {e}"); return [file_path]


# Modified signature: accepts upload_id instead of root_temp_dir
# base_path is the relative directory *within* the GCS upload prefix
def resolve_config_references(config: Dict[str, Any], upload_id: Optional[str], base_path: str = '') -> Dict[str, Any]:
    """
    Resolve config fields pointing to YAML files from local storage.

    Args:
        config: The parsed YAML configuration.
        upload_id: The unique ID for the upload context.
        base_path: The relative directory path within the upload directory for the *current* file being processed.

    Returns:
        Configuration with resolved config fields (or error markers).
    """
    if not config or 'modules' not in config or not upload_id:
        return config # Cannot resolve without context

    modules = config['modules']

    for module_name, module_data in modules.items():
        if module_name in ['input', 'output']: continue

        if isinstance(module_data, dict) and 'config' in module_data and isinstance(module_data['config'], str):
            original_config_path_str = module_data['config'] # This is the relative path string from the YAML

            # --- Local Path Resolution ---
            # Assume relative paths are relative to the *current file's* directory within the upload directory
            if not original_config_path_str.startswith('/'):
                 # Normalize path separators and combine with base_path
                 normalized_ref_path = os.path.normpath(os.path.join(base_path, original_config_path_str))
            else:
                 # If it's an absolute path in the YAML, treat it as relative to the *root* of the upload directory
                 normalized_ref_path = os.path.normpath(original_config_path_str.lstrip('/'))

            # Get the full local file path
            local_file_path = get_upload_file_path(upload_id, normalized_ref_path)

            print(f"Module {module_name}: Resolving '{original_config_path_str}' relative to '{base_path}' -> local path: {local_file_path}")

            # Check if the file exists locally
            found_locally = os.path.exists(local_file_path)
            # --- End Local Path Resolution ---

            is_composable = module_data.get('cls') == 'ComposableModel'

            if is_composable:
                print(f"Module {module_name} is ComposableModel. Keeping original config path: {original_config_path_str}")
                
                # Store the normalized path instead of the original path
                # This ensures that when the frontend tries to expand the node,
                # the backend can find the file correctly
                if found_locally:
                    # Store the normalized path that will work with the get-subgraph endpoint
                    module_data['config'] = normalized_ref_path
                    print(f"Stored normalized path for ComposableModel {module_name}: {normalized_ref_path}")
                else:
                    # Keep the original path if the file wasn't found
                    module_data['config'] = original_config_path_str
                    print(f"Warning: Config path '{original_config_path_str}' (-> {local_file_path}) for ComposableModel {module_name} not found.")
                
                continue # Skip parsing for ComposableModel

            # --- If not ComposableModel, attempt to read and parse ---
            if not found_locally:
                print(f"Warning: Config file '{original_config_path_str}' (-> {local_file_path}) not found in upload context {upload_id}. Keeping original path.")
                # Keep the original path string instead of setting an error
                module_data['config'] = original_config_path_str
                continue

            # File found locally, read and process
            try:
                with open(local_file_path, 'r') as f:
                    ref_content = f.read()

                # Recursively parse the content of the referenced file
                # Pass the *same* upload_id and the *new* base_path (relative dir of the referenced file)
                ref_base_path = os.path.dirname(normalized_ref_path)
                parsed_ref_config = parse_yaml_content(ref_content, upload_id=upload_id, base_path=ref_base_path)

                # Replace the string reference with the parsed content
                module_data['config'] = parsed_ref_config

            except Exception as e:
                error_msg = f"Error reading/parsing config reference '{original_config_path_str}' (from {local_file_path}): {e}"
                tb_str = traceback.format_exc()
                print(f"{error_msg}\n{tb_str}")
                # Keep the original path string instead of setting an error
                print(f"Warning: Error processing config file '{original_config_path_str}'. Keeping original path.")
                module_data['config'] = original_config_path_str

    return config


# Modified signature: accepts upload_id and relative_path
def process_yaml_file(upload_id: str, relative_path: str) -> Dict[str, Any]:
    """
    Read a specific YAML file from local storage based on upload_id and relative_path,
    parse it, and resolve its config references.

    Args:
        upload_id: The unique ID for the upload context.
        relative_path: The relative path of the YAML file within the upload directory.

    Returns:
        Parsed YAML configuration or an error dictionary.
    """
    local_file_path = get_upload_file_path(upload_id, os.path.normpath(relative_path))

    try:
        if not os.path.exists(local_file_path):
            # Return a specific error structure if file not found
            return {
                'error': f"File not found: {relative_path}",
                'errorType': 'CONFIG_FILE_NOT_FOUND_GCS' # Keep same error type for compatibility
            }

        # Read the content from the local file
        with open(local_file_path, 'r') as f:
            content = f.read()

        # Parse the content, passing the upload_id and the relative directory of the file
        base_path = os.path.dirname(relative_path)
        return parse_yaml_content(content, upload_id=upload_id, base_path=base_path)

    except Exception as e:
        error_msg = f"Error processing YAML file from local storage ({local_file_path}): {e}"
        tb_str = traceback.format_exc()
        print(f"{error_msg}\n{tb_str}")
        return {'error': error_msg, 'errorType': 'PROCESSING_ERROR'}


def fetch_yaml_file(url: str) -> Dict[str, Any]:
    """
    Fetch a YAML file from an external URL, parse it, and resolve config references.
    NOTE: Assumes references within the fetched file are also external URLs or
          self-contained. Does not use upload context.
    """
    try:
        # Get the base path for resolving relative paths (less reliable for URLs)
        base_path = os.path.dirname(url)

        # Fetch the YAML file
        response = requests.get(url)
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        content = response.text

        # Parse the YAML content - NO upload_id is passed, so references won't be resolved via GCS
        # This assumes the external file is self-contained or references other public URLs
        # parse_yaml_content needs to handle upload_id=None gracefully
        return parse_yaml_content(content, base_path=base_path, upload_id=None)
    except requests.exceptions.RequestException as e:
        print(f"Error fetching URL {url}: {e}")
        return {'error': f"Failed to fetch URL: {e}"}
    except Exception as e:
        print(f"Error processing fetched YAML from {url}: {e}")
        return {'error': f"Error processing fetched YAML: {e}"}
