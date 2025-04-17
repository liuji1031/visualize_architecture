import os
import yaml
import requests
from typing import Dict, Any, Optional, List, Tuple
from omegaconf import OmegaConf

def parse_yaml_content(content: str, base_path: str = '') -> Dict[str, Any]:
    """
    Parse YAML content using OmegaConf, resolve interpolations, and resolve config references.
    
    Args:
        content: YAML content as a string
        base_path: Base path for resolving relative file paths
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Parse the YAML content using OmegaConf
    config = OmegaConf.create(yaml.safe_load(content))
    
    # Resolve interpolation expressions
    resolved_config = OmegaConf.to_container(config, resolve=True)
    
    # Resolve config references
    return resolve_config_references(resolved_config, base_path)

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
            config_path = module_data['config']
            
            # Resolve the path relative to the base path
            if not config_path.startswith('/'):
                # Try different path resolutions
                possible_paths = [
                    # Path relative to the base path
                    os.path.join(base_path, config_path),
                    # Path relative to the current working directory
                    os.path.join(os.getcwd(), config_path),
                    # Path relative to the config directory
                    os.path.join(os.getcwd(), 'config', os.path.basename(config_path)),
                    # Path as is
                    config_path
                ]
                
                # Try each path until one works
                for path in possible_paths:
                    if os.path.exists(path):
                        resolved_path = path
                        references.append((module_name, resolved_path))
                        break
    
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
    
    # Read the YAML file
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Parse the YAML content
    config = yaml.safe_load(content)
    
    # Find all referenced files
    references = find_config_references(config, base_path)
    
    # Initialize the list of all referenced files
    all_references = [file_path]
    
    # Recursively find references in referenced files
    for module_name, ref_path in references:
        if ref_path not in all_references:
            all_references.append(ref_path)
            
            try:
                # Find references in the referenced file
                nested_references = find_all_config_references(ref_path)
                
                # Add new references to the list
                for nested_ref in nested_references:
                    if nested_ref not in all_references:
                        all_references.append(nested_ref)
            except Exception as e:
                print(f"Error finding references in {ref_path}: {e}")
    
    return all_references

def resolve_config_references(config: Dict[str, Any], base_path: str = '') -> Dict[str, Any]:
    """
    Resolve config fields that are strings pointing to YAML files.
    
    Args:
        config: The parsed YAML configuration
        base_path: Base path for resolving relative file paths
        
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
            config_path = module_data['config']
            
            # Resolve the path relative to the base path
            if not config_path.startswith('/'):
                # Try different path resolutions
                possible_paths = [
                    # Path relative to the base path
                    os.path.join(base_path, config_path),
                    # Path relative to the current working directory
                    os.path.join(os.getcwd(), config_path),
                    # Path relative to the config directory
                    os.path.join(os.getcwd(), 'config', os.path.basename(config_path)),
                    # Path as is
                    config_path
                ]
                
                # Try each path until one works
                for path in possible_paths:
                    if os.path.exists(path):
                        config_path = path
                        break
                else:
                    # If none of the paths work, use the first one and let it fail with a clear error
                    config_path = possible_paths[0]
            
            try:
                print(f"Attempting to read config file for module {module_name} from: {config_path}")
                
                # Check if the file exists
                if not os.path.exists(config_path):
                    raise FileNotFoundError(f"Config file not found: {config_path}")
                
                # Read and parse the referenced YAML file
                with open(config_path, 'r') as f:
                    config_content = f.read()
                
                # Parse the YAML content using OmegaConf
                config_yaml = OmegaConf.create(yaml.safe_load(config_content))
                
                # Resolve interpolation expressions
                parsed_config = OmegaConf.to_container(config_yaml, resolve=True)
                
                # Replace the string reference with the parsed content
                module_data['config'] = parsed_config
                
                # Store the resolved config path for debugging
                module_data['_resolved_config_path'] = config_path
            except Exception as e:
                print(f"Error resolving config reference for module {module_name}: {e}")
    
    return config

def process_yaml_file(file_path: str) -> Dict[str, Any]:
    """
    Load a YAML file, parse it, and resolve config references.
    
    Args:
        file_path: Path to the YAML file
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Get the base path for resolving relative paths
    base_path = os.path.dirname(file_path)
    
    # Read the YAML file
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Parse the YAML content
    return parse_yaml_content(content, base_path)

def fetch_yaml_file(url: str) -> Dict[str, Any]:
    """
    Fetch a YAML file from a URL, parse it, and resolve config references.
    
    Args:
        url: URL of the YAML file
        
    Returns:
        Parsed YAML configuration with resolved interpolations and config references
    """
    # Get the base path for resolving relative paths
    base_path = os.path.dirname(url)
    
    # Fetch the YAML file
    response = requests.get(url)
    response.raise_for_status()
    content = response.text
    
    # Parse the YAML content
    return parse_yaml_content(content, base_path)
