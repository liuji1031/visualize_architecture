/**
 * API Service
 * 
 * This module provides functions to interact with the backend API
 * for YAML processing and other operations.
 */

import { YamlConfig } from '../types';

/**
 * Response from the list-presets endpoint
 */
export interface PresetsResponse {
  presets: string[];
}

/**
 * Response from the check-references endpoint
 */
export interface ReferencesResponse {
  references: string[];
  count: number;
}

/**
 * Options for uploading a folder
 */
export interface UploadFolderOptions {
  zipFile: File;
  mainFile: string;
}

/**
 * Response type for successful uploads, including the upload ID
 */
export interface UploadResponse {
  config: YamlConfig;
  uploadId: string;
}

// Backend API base URL
export const API_BASE_URL = 'https://network-visualizer-backend-846251040656.us-east4.run.app/api'; // Will be replaced during build/deployment

/**
 * Clean up the GCS resources for a specific upload session
 * @param uploadId - The unique ID of the upload session to clean up
 * @returns Promise resolving to a success message
 */
export const cleanupUpload = async (uploadId: string | null): Promise<{ message: string }> => {
  if (!uploadId) {
    // Nothing to clean up if there's no current upload ID
    return Promise.resolve({ message: 'No active upload to clean up.' });
  }
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/cleanup-upload`, { // Renamed endpoint
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uploadId }),
      // credentials: 'include', // Not needed if not relying on cookies
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to clean up upload ${uploadId}: ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error cleaning up upload ${uploadId}:`, error);
    throw error; // Re-throw to allow calling component to handle
  }
};

/**
 * Parse YAML content via the backend API
 * @param content - YAML content as string
 * @returns Promise resolving to parsed YAML configuration
 */
export const parseYamlContent = async (content: string): Promise<YamlConfig> => {
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error(`Failed to parse YAML: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error parsing YAML content:', error);
    throw error;
  }
};

/**
 * Check a YAML file for references to other YAML files
 * @param file - File object to check
 * @returns Promise resolving to a list of referenced files
 */
export const checkYamlReferences = async (file: File): Promise<ReferencesResponse> => {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/yaml/check-references`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to check YAML references: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error checking YAML references:', error);
    throw error;
  }
};

/**
 * Upload and process a YAML file via the backend API
 * @param file - File object to upload
 * @param autoUploadReferences - Whether to automatically upload referenced files
 * @returns Promise resolving to an object containing parsed YAML configuration and uploadId
 */
export const uploadYamlFile = async (file: File): Promise<UploadResponse> => {
  // Removed autoUploadReferences as it's less relevant with GCS handling
  try {
    const formData = new FormData();
    formData.append('file', file);
    // formData.append('auto_upload_references', 'false'); // Explicitly false if needed by backend

    const response = await fetch(`${API_BASE_URL}/yaml/upload`, {
      method: 'POST',
      body: formData,
      // credentials: 'include', // Not needed if not relying on cookies
    });

    if (!response.ok) {
       const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to upload YAML file: ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    // Expect { config: YamlConfig, uploadId: string }
    return await response.json();
  } catch (error) {
    console.error('Error uploading YAML file:', error);
    throw error;
  }
};

/**
 * Upload a folder of YAML files and process the main YAML file
 * @param options - Upload folder options
 * @returns Promise resolving to an object containing parsed YAML configuration and uploadId
 */
export const uploadYamlFolder = async (options: UploadFolderOptions): Promise<UploadResponse> => {
  try {
    const formData = new FormData();
    formData.append('zip_file', options.zipFile);
    formData.append('main_file', options.mainFile);

    const response = await fetch(`${API_BASE_URL}/yaml/upload-folder`, {
      method: 'POST',
      body: formData,
      // credentials: 'include', // Not needed if not relying on cookies
    });

    if (!response.ok) {
       const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to upload YAML folder: ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    // Expect { config: YamlConfig, uploadId: string }
    return await response.json();
  } catch (error) {
    console.error('Error uploading YAML folder:', error);
    throw error;
  }
};

/**
 * Fetch a YAML file from a URL and process it via the backend API
 * @param url - URL of the YAML file
 * @returns Promise resolving to parsed YAML configuration
 */
// Note: The backend route /api/yaml/fetch was renamed to /api/yaml/get-subgraph
// and now works with relative paths in a session context.
// This function uses the original /fetch endpoint, assuming it's for external URLs.
// The /get-subgraph endpoint is used for relative paths within session context.
export const fetchYamlFile = async (url: string): Promise<YamlConfig> => {
  try {
    // Point back to the original /fetch endpoint for external URLs
    const response = await fetch(`${API_BASE_URL}/yaml/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Send the URL as 'url'
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
       const errorData = await response.json().catch(() => ({})); // Try to get error details
      throw new Error(`Failed to fetch YAML file from URL (${response.status} ${response.statusText}): ${errorData.error || 'Unknown error'}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching YAML file:', error);
    // Re-throw the original error which might have more context
    throw error instanceof Error ? error : new Error(String(error));
  }
};

/**
 * Error response from the get-subgraph endpoint when a config file is not found
 */
export interface ConfigFileNotFoundError {
  error: string;
  errorType: 'CONFIG_FILE_NOT_FOUND';
  configPath: string;
  moduleName: string;
}

/**
 * Fetch subgraph configuration using uploadId and relative path
 * @param uploadId - The unique ID of the upload session
 * @param relativePath - Relative path within the GCS upload prefix
 * @param moduleName - Name of the module requesting the config
 * @returns Promise resolving to parsed YAML configuration
 */
export const getSubgraphConfig = async (uploadId: string | null, relativePath: string, moduleName: string = 'ComposableModel'): Promise<YamlConfig> => {
  if (!uploadId) {
    // Handle case where there's no active upload context
    throw new Error("No active upload session found. Please upload a file or folder first.");
  }
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/get-subgraph`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Send uploadId, relativePath, and moduleName in the body
      body: JSON.stringify({ uploadId, relativePath, moduleName }),
      // credentials: 'include', // Not needed if not relying on cookies
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})); // Try to get error details
      
      // Check if this is a CONFIG_FILE_NOT_FOUND error
      if (response.status === 404 && errorData.errorType === 'CONFIG_FILE_NOT_FOUND') {
        // Create a custom error with the specific error type and details
        const configError = errorData as ConfigFileNotFoundError;
        const error = new Error(`CONFIG_FILE_NOT_FOUND:${configError.configPath}:${configError.moduleName}`);
        error.name = 'ConfigFileNotFoundError';
        throw error;
      }
      
      // Handle other errors
      let errorMessage = `Failed to get subgraph config (${response.status} ${response.statusText})`;
      if (errorData.error) {
        errorMessage += `: ${errorData.error}`;
      }
      if (response.status === 400 && errorData.error?.includes("No active upload context")) {
        errorMessage += " Please upload the folder again.";
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting subgraph config:', error);
    // Re-throw the original error which might have more context
    throw error instanceof Error ? error : new Error(String(error));
  }
};

/**
 * Crop an image using the backend API
 * @param imageData - Base64-encoded image data or data URL
 * @param format - 'svg', 'png', or 'auto' to determine from the data
 * @param padding - Padding in pixels to add around the content
 * @returns Promise resolving to a blob URL for the cropped image
 */
export const cropImage = async (
  imageData: string,
  format: 'svg' | 'png' | 'auto' = 'auto',
  padding: number = 30
): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/crop-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_data: imageData, format, padding }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to crop image');
    }

    // Convert the response to a blob URL
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Error cropping image:', error);
    throw error;
  }
};

/**
 * List all available pre-uploaded configurations from the GCS bucket
 * @returns Promise resolving to a list of preset names
 */
export const listPresetConfigurations = async (): Promise<string[]> => {
  try {
    console.log(`Fetching preset configurations from ${API_BASE_URL}/yaml/list-presets`);
    
    const response = await fetch(`${API_BASE_URL}/yaml/list-presets`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log(`Received response with status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorData = await response.json().catch((parseError) => {
        console.error('Error parsing error response:', parseError);
        return {};
      });
      
      console.error('Error response details:', errorData);
      
      if (errorData.details) {
        console.error('Additional error details:', errorData.details);
      }
      
      throw new Error(`Failed to list presets: ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    const data: PresetsResponse = await response.json();
    console.log(`Successfully fetched ${data.presets.length} preset configurations:`, data.presets);
    return data.presets;
  } catch (error) {
    console.error('Error listing preset configurations:', error);
    // Return empty array instead of throwing to prevent UI errors
    return [];
  }
};

/**
 * Load a pre-uploaded configuration from the GCS bucket
 * @param presetName - The name of the preset to load (subfolder name)
 * @returns Promise resolving to an object containing parsed YAML configuration and uploadId
 */
export const loadPresetConfiguration = async (presetName: string): Promise<UploadResponse> => {
  try {
    console.log(`Loading preset configuration '${presetName}' from ${API_BASE_URL}/yaml/load-preset`);
    
    const response = await fetch(`${API_BASE_URL}/yaml/load-preset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ presetName }),
    });

    console.log(`Received response with status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorData = await response.json().catch((parseError) => {
        console.error('Error parsing error response:', parseError);
        return {};
      });
      
      console.error('Error response details:', errorData);
      
      if (errorData.details) {
        console.error('Additional error details:', errorData.details);
      }
      
      throw new Error(`Failed to load preset '${presetName}': ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    // Expect { config: YamlConfig, uploadId: string }
    const data = await response.json();
    console.log(`Successfully loaded preset configuration '${presetName}' with uploadId: ${data.uploadId}`);
    return data;
  } catch (error) {
    console.error(`Error loading preset configuration '${presetName}':`, error);
    throw error;
  }
};
