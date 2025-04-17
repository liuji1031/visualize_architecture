/**
 * YAML Processor Wrapper
 * 
 * This module provides a wrapper around the Python YAML processor script
 * that uses OmegaConf to resolve interpolation expressions.
 */

import { YamlConfig } from '../types';
import { parseYamlContent, resolveConfigReferences } from './yamlParser';

/**
 * Process a YAML file using the Python OmegaConf processor
 * @param filePath - Path to the YAML file to process
 * @returns Promise resolving to the processed YAML configuration
 */
export const processYamlFile = async (filePath: string): Promise<YamlConfig> => {
  try {
    // Execute the Python script to process the YAML file
    const process = window.require('child_process');
    const { exec } = process;
    
    return new Promise<YamlConfig>((resolve, reject) => {
      exec(`python3 ${process.cwd()}/scripts/yaml_processor.py "${filePath}"`, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error(`Error processing YAML file: ${error.message}`);
          console.error(`stderr: ${stderr}`);
          reject(error);
          return;
        }
        
        if (stderr) {
          console.warn(`Warning from YAML processor: ${stderr}`);
        }
        
        // Extract the path to the processed file from the output
        const outputLines = stdout.trim().split('\n');
        const lastLine = outputLines[outputLines.length - 1];
        const match = lastLine.match(/Processed YAML saved to: (.+)/);
        
        if (!match) {
          reject(new Error('Could not find processed YAML file path in output'));
          return;
        }
        
        const processedFilePath = match[1];
        
        // Read the processed file
        const fs = window.require('fs');
        fs.readFile(processedFilePath, 'utf8', (err: Error | null, data: string) => {
          if (err) {
            console.error(`Error reading processed YAML file: ${err.message}`);
            reject(err);
            return;
          }
          
          try {
            // Parse the processed YAML content
            const config = parseYamlContent(data, processedFilePath.substring(0, processedFilePath.lastIndexOf('/') + 1));
            resolveConfigReferences(config, processedFilePath.substring(0, processedFilePath.lastIndexOf('/') + 1))
              .then(resolvedConfig => resolve(resolvedConfig))
              .catch(() => resolve(config));
          } catch (parseError) {
            console.error(`Error parsing processed YAML content: ${parseError}`);
            reject(parseError);
          }
        });
      });
    });
  } catch (error) {
    console.error('Error in processYamlFile:', error);
    throw error;
  }
};

/**
 * Process YAML content using the Python OmegaConf processor
 * @param content - YAML content as a string
 * @returns Promise resolving to the processed YAML configuration
 */
export const processYamlContent = async (content: string): Promise<YamlConfig> => {
  try {
    // Create a temporary file with the YAML content
    const fs = window.require('fs');
    const os = window.require('os');
    const path = window.require('path');
    
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `temp_yaml_${Date.now()}.yaml`);
    
    return new Promise<YamlConfig>((resolve, reject) => {
      // Write the content to a temporary file
      fs.writeFile(tempFilePath, content, 'utf8', (writeErr: Error | null) => {
        if (writeErr) {
          console.error(`Error writing temporary YAML file: ${writeErr.message}`);
          reject(writeErr);
          return;
        }
        
        // Process the temporary file
        processYamlFile(tempFilePath)
          .then((config) => {
            // Clean up the temporary file
            fs.unlink(tempFilePath, (unlinkErr: Error | null) => {
              if (unlinkErr) {
                console.warn(`Warning: Could not delete temporary file ${tempFilePath}: ${unlinkErr.message}`);
              }
            });
            
            resolve(config);
          })
          .catch((processErr) => {
            // Clean up the temporary file
            fs.unlink(tempFilePath, (unlinkErr: Error | null) => {
              if (unlinkErr) {
                console.warn(`Warning: Could not delete temporary file ${tempFilePath}: ${unlinkErr.message}`);
              }
            });
            
            reject(processErr);
          });
      });
    });
  } catch (error) {
    console.error('Error in processYamlContent:', error);
    throw error;
  }
};
