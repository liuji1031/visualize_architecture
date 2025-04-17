import yaml from 'js-yaml';
import { YamlConfig, YamlModule } from '../types';
import { processYamlInterpolation } from './yamlInterpolator';

/**
 * Resolves config fields that are strings pointing to YAML files
 * @param config - The parsed YAML configuration
 * @param basePath - The base path for resolving relative file paths
 * @returns The configuration with resolved config fields
 */
export const resolveConfigReferences = async (config: YamlConfig, basePath: string = ''): Promise<YamlConfig> => {
  if (!config.modules) {
    return config;
  }

  const resolvedModules: Record<string, any> = {};

  // Process each module
  for (const [moduleName, moduleData] of Object.entries(config.modules)) {
    // Skip entry and exit modules which have different structures
    if (moduleName === 'entry' || moduleName === 'exit') {
      resolvedModules[moduleName] = moduleData;
      continue;
    }

    // Cast to YamlModule and check if it has a config field
    const module = moduleData as YamlModule;
    if (module.config && typeof module.config === 'string') {
      try {
        // Resolve the path relative to the base path
        const configPath = (module.config as string).startsWith('/') 
          ? module.config as string
          : `${basePath}${module.config}`;
        
        console.log(`Resolving config reference for module ${moduleName}: ${configPath}`);
        
        // Fetch the YAML file
        const response = await fetch(configPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch config file: ${response.statusText}`);
        }
        
        // Parse the YAML content
        const configContent = await response.text();
        console.log(`Config content for ${moduleName}:`, configContent);
        
        const parsedConfig = yaml.load(configContent);
        console.log(`Parsed config for ${moduleName}:`, parsedConfig);
        
        if (parsedConfig === null || typeof parsedConfig !== 'object') {
          throw new Error(`Invalid config file format for ${moduleName}: expected an object`);
        }
        
        // Replace the string reference with the parsed content
        resolvedModules[moduleName] = {
          ...module,
          config: parsedConfig as Record<string, any>
        };
      } catch (error) {
        console.error(`Error resolving config reference for module ${moduleName}:`, error);
        // Keep the original reference if there's an error
        resolvedModules[moduleName] = moduleData;
      }
    } else {
      // No string reference to resolve
      resolvedModules[moduleName] = moduleData;
    }
  }

  return {
    ...config,
    modules: resolvedModules
  };
};

/**
 * Parse YAML content into a structured configuration object
 * @param content - YAML content as string
 * @param basePath - The base path for resolving relative file paths
 * @returns Parsed YAML configuration
 */
export const parseYamlContent = (content: string, basePath: string = ''): YamlConfig => {
  try {
    // First, parse the YAML content
    const parsedYaml = yaml.load(content) as { modules: Record<string, any> };
    
    if (!parsedYaml || !parsedYaml.modules || typeof parsedYaml.modules !== 'object') {
      throw new Error('Invalid YAML structure: missing or invalid modules object');
    }
    
    try {
      // Process interpolation expressions
      console.log('Processing YAML interpolation expressions...');
      const processedYaml = processYamlInterpolation(content);
      console.log('YAML interpolation processing complete');
      return processedYaml;
    } catch (interpolationError) {
      console.warn('Error processing interpolation expressions:', interpolationError);
      console.warn('Falling back to standard YAML parsing');
      // Fall back to the standard parsed YAML if interpolation fails
      return parsedYaml as YamlConfig;
    }
  } catch (error) {
    console.error('Error parsing YAML:', error);
    throw new Error(`Failed to parse YAML: ${(error as Error).message}`);
  }
};

/**
 * Read a YAML file and parse its content
 * @param file - File object to read
 * @returns Promise resolving to parsed YAML configuration
 */
export const readYamlFile = (file: File): Promise<YamlConfig> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        
        // Get the file path for resolving relative paths
        const filePath = file.webkitRelativePath || '';
        const basePath = filePath ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
        
        // Parse the YAML content
        const config = parseYamlContent(content, basePath);
        
        try {
          // Resolve any config references
          const resolvedConfig = await resolveConfigReferences(config, basePath);
          resolve(resolvedConfig);
        } catch (resolveError) {
          console.warn('Error resolving config references:', resolveError);
          // Fall back to the original config if there's an error
          resolve(config);
        }
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
};

/**
 * Fetch a YAML file from a URL and parse its content
 * @param url - URL of the YAML file
 * @returns Promise resolving to parsed YAML configuration
 */
export const fetchYamlFile = async (url: string): Promise<YamlConfig> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch YAML file: ${response.statusText}`);
    }
    
    const content = await response.text();
    // Extract the base directory from the URL for resolving relative paths
    const basePath = url.substring(0, url.lastIndexOf('/') + 1);
    
    // Parse the YAML content
    const parsedConfig = parseYamlContent(content, basePath);
    
    // Resolve any config references
    return await resolveConfigReferences(parsedConfig, basePath);
  } catch (error) {
    console.error('Error fetching YAML file:', error);
    throw error;
  }
};
