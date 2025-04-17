/**
 * YAML Interpolator
 * 
 * This module provides functionality to interpolate variables in YAML configurations
 * similar to OmegaConf's interpolation feature.
 */

import yaml from 'js-yaml';
import { YamlConfig } from '../types';

/**
 * Resolves a variable reference in the format ${path.to.variable}
 * @param reference - The reference string (e.g., "defaults.in_channels")
 * @param config - The full configuration object
 * @returns The resolved value
 */
const resolveReference = (reference: string, config: any): any => {
  const parts = reference.split('.');
  let current = config;
  
  for (const part of parts) {
    if (current === undefined || current === null) {
      throw new Error(`Cannot resolve reference ${reference}: path does not exist`);
    }
    current = current[part];
  }
  
  return current;
};

/**
 * Evaluates a simple expression like "value * 2"
 * @param value - The base value
 * @param operator - The operator (*, /, +, -)
 * @param operand - The operand value
 * @returns The result of the operation
 */
const evaluateExpression = (value: number, operator: string, operand: number): number => {
  switch (operator) {
    case '*':
      return value * operand;
    case '/':
      return value / operand;
    case '+':
      return value + operand;
    case '-':
      return value - operand;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
};

/**
 * Parses and evaluates an interpolation expression
 * @param expr - The expression string (e.g., "${defaults.out_channels * 2}")
 * @param config - The full configuration object
 * @returns The resolved value
 */
const evaluateInterpolation = (expr: string, config: any): any => {
  // Extract the reference part from ${...}
  const match = expr.match(/\${([^}]*)}/);
  if (!match) {
    return expr;
  }
  
  const reference = match[1].trim();
  
  // Check if it's a simple reference or an expression
  const exprMatch = reference.match(/^([a-zA-Z0-9_.]+)\s*([*+\-/])\s*([0-9.]+)$/);
  
  if (exprMatch) {
    // It's an expression like "defaults.out_channels * 2"
    const [, refPath, operator, operandStr] = exprMatch;
    const baseValue = resolveReference(refPath, config);
    const operand = parseFloat(operandStr);
    
    if (typeof baseValue !== 'number') {
      throw new Error(`Cannot perform operation on non-numeric value: ${baseValue}`);
    }
    
    return evaluateExpression(baseValue, operator, operand);
  } else {
    // It's a simple reference like "defaults.in_channels"
    return resolveReference(reference, config);
  }
};

/**
 * Recursively processes an object to resolve all interpolation expressions
 * @param obj - The object to process
 * @param config - The full configuration object (for resolving references)
 * @returns The processed object with all interpolations resolved
 */
const processObject = (obj: any, config: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // Check if the string contains an interpolation expression
    if (obj.includes('${')) {
      return evaluateInterpolation(obj, config);
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => processObject(item, config));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = processObject(value, config);
    }
    return result;
  }
  
  return obj;
};

/**
 * Processes a YAML string to resolve all interpolation expressions
 * @param yamlContent - The YAML content as a string
 * @returns The processed YAML configuration with all interpolations resolved
 */
export const processYamlInterpolation = (yamlContent: string): YamlConfig => {
  // Parse the YAML content
  const config = yaml.load(yamlContent) as any;
  
  if (!config) {
    throw new Error('Failed to parse YAML content');
  }
  
  // Process the configuration to resolve all interpolations
  const processedConfig = processObject(config, config);
  
  return processedConfig as YamlConfig;
};
