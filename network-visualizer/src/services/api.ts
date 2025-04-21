/**
 * API Service
 * 
 * This module provides functions to interact with the backend API
 * for YAML processing and other operations.
 */

import { YamlConfig } from '../types';

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

// Backend API base URL
const API_BASE_URL = 'http://localhost:5000/api';

/**
 * Clean up the temporary directory stored in the session
 * @returns Promise resolving to a success message
 */
export const cleanupTempDirectory = async (): Promise<{ message: string }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/cleanup-temp`, {
      method: 'POST',
      credentials: 'include', // Ensure session cookies are sent
    });

    if (!response.ok) {
      throw new Error(`Failed to clean up temporary directory: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error cleaning up temporary directory:', error);
    throw error;
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
 * @returns Promise resolving to parsed YAML configuration
 */
export const uploadYamlFile = async (file: File, autoUploadReferences: boolean = false): Promise<YamlConfig> => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('auto_upload_references', autoUploadReferences.toString());

    const response = await fetch(`${API_BASE_URL}/yaml/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload YAML file: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error uploading YAML file:', error);
    throw error;
  }
};

/**
 * Upload a folder of YAML files and process the main YAML file
 * @param options - Upload folder options
 * @returns Promise resolving to parsed YAML configuration
 */
export const uploadYamlFolder = async (options: UploadFolderOptions): Promise<YamlConfig> => {
  try {
    const formData = new FormData();
    formData.append('zip_file', options.zipFile);
    formData.append('main_file', options.mainFile);

    const response = await fetch(`${API_BASE_URL}/yaml/upload-folder`, {
      method: 'POST',
      body: formData,
      credentials: 'include', // Ensure session cookies are sent
    });

    if (!response.ok) {
      throw new Error(`Failed to upload YAML folder: ${response.statusText}`);
    }

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
 * Fetch subgraph configuration using a relative path (within session context)
 * @param relativePath - Relative path within the uploaded folder context
 * @returns Promise resolving to parsed YAML configuration
 */
export const getSubgraphConfig = async (relativePath: string): Promise<YamlConfig> => {
  try {
    const response = await fetch(`${API_BASE_URL}/yaml/get-subgraph`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Send relativePath in the body
      body: JSON.stringify({ relativePath }),
      credentials: 'include', // Ensure session cookies are sent
    });

    if (!response.ok) {
       const errorData = await response.json().catch(() => ({})); // Try to get error details
      // Provide a more specific error message based on status
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
