import os
import yaml
import requests
from typing import Dict, Any, Optional, List, Tuple
from omegaconf import OmegaConf

# Modified signature to accept root_temp_dir
def parse_yaml_content(content: str, base_path: str = '', root_temp_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse YAML content using OmegaConf, resolve interpolations, and resolve config references.

    Args:
        content: YAML content as a string
        base_path: Base path for resolving relative file paths
        root_temp_dir: The root temporary directory for the current upload context (if any)

    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Parse the YAML content using OmegaConf
    config = OmegaConf.create(yaml.safe_load(content))

    # Resolve interpolation expressions
    resolved_config = OmegaConf.to_container(config, resolve=True)

    # Resolve config references, passing root_temp_dir
    return resolve_config_references(resolved_config, base_path, root_temp_dir)

def find_config_references(config: Dict[str, Any], base_path: str = '') -> List[Tuple[str, str]]:
    """
    Find all config fields that are strings pointing to YAML files.

    Args:
        config: The parsed YAML configuration
        base_path: Base path for resolving relative file paths

    Returns:
        List of tuples (module_name, config_path) for each referenced file
    """
    references = []

    if not config or 'modules' not in config:
        return references

    modules = config['modules']

    # Process each module
    for module_name, module_data in modules.items():
        # Skip entry and exit modules which have different structures
        if module_name in ['entry', 'exit']:
            continue

        # Check if the module has a config field that is a string
        if isinstance(module_data, dict) and 'config' in module_data and isinstance(module_data['config'], str):
            config_path_str = module_data['config'] # Use a consistent name for the original string path

            # Resolve the path relative to the base path
            resolved_path = config_path_str # Initialize resolved_path with the original string
            found_path_in_find = False # Use a different flag name to avoid scope issues
            if not config_path_str.startswith('/'):
                # Try different path resolutions using the original string
                possible_paths = [
                    os.path.join(base_path, config_path_str),
                    os.path.join(os.getcwd(), config_path_str),
                    # os.path.join(os.getcwd(), 'config', os.path.basename(config_path_str)), # Too specific
                    config_path_str
                ]

                # Try each path until one works
                for path in possible_paths:
                    if os.path.exists(path):
                        resolved_path = path # Update resolved_path if found
                        references.append((module_name, resolved_path))
                        found_path_in_find = True
                        break
                # If not found_path_in_find, we don't add to references in this function
            elif os.path.exists(resolved_path): # Check if absolute path exists
                 references.append((module_name, resolved_path))
                 found_path_in_find = True

    return references

def find_all_config_references(file_path: str) -> List[str]:
    """
    Recursively find all YAML files referenced in a YAML file and its referenced files.

    Args:
        file_path: Path to the YAML file

    Returns:
        List of paths to all referenced YAML files
    """
    # Get the base path for resolving relative paths
    base_path = os.path.dirname(file_path)
    print(f"Finding all config references in: {file_path}")

    try:
        # Read the YAML file
        with open(file_path, 'r') as f:
            content = f.read()

        # Parse the YAML content
        config = yaml.safe_load(content)

        # Find all referenced files relative to the current file's directory
        references = find_config_references(config, base_path)

        # Initialize the list of all referenced files
        all_references = [file_path]

        # Recursively find references in referenced files
        processed_paths = {file_path} # Keep track of processed files to avoid infinite loops
        queue = [ref_path for _, ref_path in references]

        while queue:
            current_ref_path = queue.pop(0)
            if current_ref_path in processed_paths:
                continue
            processed_paths.add(current_ref_path)
            if current_ref_path not in all_references:
                 all_references.append(current_ref_path)

            try:
                # Find references in the referenced file
                nested_references = find_all_config_references(current_ref_path) # Recursive call

                # Add new references to the queue if not already processed or queued
                for nested_ref in nested_references:
                    if nested_ref not in processed_paths and nested_ref not in queue:
                        queue.append(nested_ref)
            except FileNotFoundError:
                 print(f"Warning: Referenced file not found during recursive search: {current_ref_path}")
            except Exception as e:
                print(f"Error finding references in {current_ref_path}: {e}")

        return all_references
    except FileNotFoundError:
         print(f"Error: Initial file not found in find_all_config_references: {file_path}")
         return [file_path] # Return only the initial path if it doesn't exist
    except Exception as e:
        print(f"Error reading or parsing initial file {file_path} in find_all_config_references: {e}")
        return [file_path]


# Modified signature to accept root_temp_dir
def resolve_config_references(config: Dict[str, Any], base_path: str = '', root_temp_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Resolve config fields that are strings pointing to YAML files.

    Args:
        config: The parsed YAML configuration
        base_path: Base path (directory of the current file being processed)
        root_temp_dir: The root temporary directory for the current upload context (if any)

    Returns:
        Configuration with resolved config fields
    """
    if not config or 'modules' not in config:
        return config

    modules = config['modules']

    # Process each module
    for module_name, module_data in modules.items():
        # Skip entry and exit modules which have different structures
        if module_name in ['entry', 'exit']:
            continue

        # Check if the module has a config field that is a string
        if isinstance(module_data, dict) and 'config' in module_data and isinstance(module_data['config'], str):
            original_config_path_str = module_data['config'] # Store the original string
            resolved_config_path = original_config_path_str # Initialize resolved path with the original

            # Resolve the path relative to the base path
            found_path_in_resolve = False
            if not original_config_path_str.startswith('/'):
                # --- Path Resolution Logic ---
                possible_paths = []
                # Priority 1: Relative to current file's directory (base_path)
                possible_paths.append(os.path.join(base_path, original_config_path_str))

                # Priority 2: If in temp context, relative to temp root
                if root_temp_dir:
                    possible_paths.append(os.path.join(root_temp_dir, original_config_path_str))

                # Fallbacks (less likely/reliable)
                possible_paths.append(os.path.join(os.getcwd(), original_config_path_str)) # Relative to CWD
                possible_paths.append(original_config_path_str) # As is

                # Remove duplicates while preserving order
                possible_paths = list(dict.fromkeys(possible_paths))
                print(f"Module {module_name}: Checking paths for '{original_config_path_str}': {possible_paths}")
                # --- End Path Resolution Logic ---

                # Try the constructed paths
                for path in possible_paths:
                    # Normalize path before checking existence
                    normalized_path = os.path.normpath(path)
                    if os.path.exists(normalized_path):
                        # Security check: If in temp context, ensure path is within root_temp_dir
                        if root_temp_dir:
                             abs_temp_dir = os.path.abspath(root_temp_dir)
                             if not os.path.abspath(normalized_path).startswith(abs_temp_dir + os.sep):
                                 print(f"Warning: Path '{normalized_path}' exists but is outside temp dir '{root_temp_dir}'. Skipping.")
                                 continue # Skip this path if outside temp dir

                        resolved_config_path = normalized_path # Update resolved path if found and valid
                        found_path_in_resolve = True
                        break # Stop searching once found
                # If not found_path_in_resolve, resolved_config_path remains the original string
            elif os.path.exists(resolved_config_path): # Check if absolute path exists
                 # Security check for absolute paths if in temp context
                 if root_temp_dir:
                      abs_temp_dir = os.path.abspath(root_temp_dir)
                      if not os.path.abspath(resolved_config_path).startswith(abs_temp_dir + os.sep):
                           print(f"Warning: Absolute path '{resolved_config_path}' is outside temp dir '{root_temp_dir}'. Treating as not found.")
                           found_path_in_resolve = False # Mark as not found if outside temp dir
                      else:
                           found_path_in_resolve = True
                 else:
                      found_path_in_resolve = True # Absolute path outside temp context is fine

            # *** Check if the module is a ComposableModel ***
            is_composable = module_data.get('cls') == 'ComposableModel'

            if is_composable:
                # For ComposableModel, ensure 'config' holds the ORIGINAL string path
                print(f"Module {module_name} is ComposableModel. Keeping original config path: {original_config_path_str}")
                module_data['config'] = original_config_path_str # Explicitly set back to original string

                if found_path_in_resolve:
                     module_data['_resolved_config_path'] = resolved_config_path # Store resolved path separately if found
                else:
                     # Log a warning if the path couldn't be resolved
                     print(f"Warning: Config path '{original_config_path_str}' for ComposableModel {module_name} could not be resolved to an existing file.")
                continue # Skip file reading and content replacement for ComposableModel

            # *** If not ComposableModel, proceed to read and parse the file using the RESOLVED path ***
            if not found_path_in_resolve:
                # If path wasn't resolved for a non-composable model, log an error, and skip
                print(f"Error: Config path '{original_config_path_str}' for non-ComposableModel module {module_name} could not be resolved to an existing file.")
                print(f"Skipping reading of config file {original_config_path_str} for module {module_name}.")
                continue # Skip processing this module further

            # Path was resolved and it's not a ComposableModel, proceed with reading
            try:
                print(f"Attempting to read config file for module {module_name} from: {resolved_config_path}")

                # Read and parse the referenced YAML file using the resolved path
                with open(resolved_config_path, 'r') as f:
                    config_content = f.read()

                # Parse the YAML content using OmegaConf
                config_yaml = OmegaConf.create(yaml.safe_load(config_content))

                # Resolve interpolation expressions
                parsed_config = OmegaConf.to_container(config_yaml, resolve=True)

                # Replace the string reference with the parsed content
                module_data['config'] = parsed_config

                # Store the resolved config path for debugging
                module_data['_resolved_config_path'] = resolved_config_path
            except Exception as e:
                # Use the original path string in the error message for clarity
                print(f"Error reading/parsing config reference '{original_config_path_str}' (resolved to '{resolved_config_path}') for module {module_name}: {e}")
                # Set config to an error state
                module_data['config'] = {'error': f"Error processing config file {original_config_path_str}: {e}"}

    return config

# Modified signature to accept root_temp_dir
def process_yaml_file(file_path: str, root_temp_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Load a YAML file, parse it, and resolve config references.

    Args:
        file_path: Absolute path to the YAML file to process.
        root_temp_dir: The root temporary directory context, if applicable.

    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Get the base path (directory of the file being processed) for resolving relative paths within this file
    base_path = os.path.dirname(file_path)

    # Read the YAML file
    with open(file_path, 'r') as f:
        content = f.read()

    # Parse the YAML content, passing both base_path and root_temp_dir
    return parse_yaml_content(content, base_path, root_temp_dir)

def fetch_yaml_file(url: str) -> Dict[str, Any]:
    """
    Fetch a YAML file from a URL, parse it, and resolve config references.

    Args:
        url: URL of the YAML file

    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Get the base path for resolving relative paths (less reliable for URLs)
    base_path = os.path.dirname(url)

    # Fetch the YAML file
    response = requests.get(url)
    response.raise_for_status()
    content = response.text

    # Parse the YAML content (no root_temp_dir context here)
    return parse_yaml_content(content, base_path)
