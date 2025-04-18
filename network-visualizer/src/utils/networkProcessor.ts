import dagre from 'dagre';
import { YamlConfig, NetworkStructure, YamlModule } from '../types';

// Constants for layout
const NODE_WIDTH = 200;
const NODE_HEIGHT = 100;
const HORIZONTAL_SPACING = 250;
const VERTICAL_SPACING = 150;

/**
 * Process the YAML configuration into a network structure for ReactFlow
 * @param config - Parsed YAML configuration
 * @returns Network structure with nodes and edges
 */
export const processNetworkStructure = (config: YamlConfig): NetworkStructure => {
  const { modules } = config;
  
  // Process nodes
  const nodes = Object.entries(modules).map(([moduleName, moduleData]) => {
    const isEntry = moduleName === 'entry';
    const isExit = moduleName === 'exit';
    
    // Handle different module data formats
    let cls: string | undefined;
    let module_type: string | undefined; // Added module_type
    let outNum = 1;
    let inputSources: string[] | Record<string, string> | undefined;
    let configData: Record<string, any> | string | undefined; // Renamed to avoid conflict with config var name
    
    if (isEntry) {
      // Entry module has inputs directly as an array
      inputSources = moduleData as string[];
    } else if (isExit) {
      // Exit module has outputs directly as a record
      inputSources = moduleData as Record<string, string>;
    } else {
      // Regular module with YamlModule structure
      const regularModule = moduleData as YamlModule;
      cls = regularModule.cls;
      // Set module_type based on cls
      if (cls === 'ComposableModel') {
        module_type = 'ComposableModel';
      }
      outNum = regularModule.out_num || 1;
      inputSources = regularModule.inp_src;
      configData = regularModule.config; // Use renamed variable
    }

    return {
      id: moduleName,
      type: isEntry ? 'input' : isExit ? 'output' : 'default',
      position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
      data: {
        label: moduleName,
        cls,
        module_type, // Add module_type to node data
        isEntry,
        isExit,
        outNum,
        inputSources, // Include input sources information
        config: configData // Use renamed variable
      }
    };
  });
  
  // Process edges
  const edges: NetworkStructure['edges'] = [];
  
  Object.entries(modules).forEach(([moduleName, moduleData]) => {
    if (moduleName === 'entry') {
      // Skip entry module as it doesn't have real connections
      return;
    }
    
    if (moduleName === 'exit') {
      // Handle exit module which can have inputs as either a list or a dictionary
      if (Array.isArray(moduleData)) {
        // Exit module has inputs as a list
        const exitInputs = moduleData as string[];
        
        exitInputs.forEach((inputSource, index) => {
          const [sourceName, sourceOutput] = parseInputSource(inputSource);
          
          // Check if the source module has multiple outputs
          const sourceModuleData = modules[sourceName];
          let hasMultipleOutputs = false;
          
          if (sourceModuleData && typeof sourceModuleData !== 'string' && !Array.isArray(sourceModuleData)) {
            const yamlModule = sourceModuleData as YamlModule;
            hasMultipleOutputs = yamlModule.out_num !== undefined && yamlModule.out_num > 1;
          }
          
          // Create the edge label based on the source module's output count
          const edgeLabel = hasMultipleOutputs && sourceOutput !== undefined 
            ? `${sourceName}:${sourceOutput}` 
            : sourceName;
          
          edges.push({
            id: `${sourceName}${sourceOutput ? `:${sourceOutput}` : ''}-to-${moduleName}-${index}`,
            source: sourceName,
            target: moduleName,
            sourceHandle: sourceOutput !== undefined ? `output-${sourceOutput}` : undefined,
            targetHandle: `input-${index}`,
            data: {
              label: edgeLabel
            }
          });
        });
      } else {
        // Exit module has inputs as a dictionary
        const exitInputs = moduleData as Record<string, string>;
        
        Object.entries(exitInputs).forEach(([outputName, inputSource]) => {
          const [sourceName, sourceOutput] = parseInputSource(inputSource);
          
          // Check if the source module has multiple outputs
          const sourceModuleData = modules[sourceName];
          let hasMultipleOutputs = false;
          
          if (sourceModuleData && typeof sourceModuleData !== 'string' && !Array.isArray(sourceModuleData)) {
            const yamlModule = sourceModuleData as YamlModule;
            hasMultipleOutputs = yamlModule.out_num !== undefined && yamlModule.out_num > 1;
          }
          
          // Create the edge label based on the source module's output count
          const edgeLabel = hasMultipleOutputs && sourceOutput !== undefined 
            ? `${sourceName}:${sourceOutput}` 
            : sourceName;
          
          edges.push({
            id: `${sourceName}${sourceOutput ? `:${sourceOutput}` : ''}-to-${moduleName}-${outputName}`,
            source: sourceName,
            target: moduleName,
            sourceHandle: sourceOutput !== undefined ? `output-${sourceOutput}` : undefined,
            targetHandle: `input-${outputName}`,
            data: {
              label: edgeLabel
            }
          });
        });
      }
    } else {
      // Handle regular modules
      const regularModule = moduleData as YamlModule;
      if (!regularModule.inp_src) {
        return; // Skip if no input sources
      }
      const inputs = regularModule.inp_src as string[];
      
      inputs.forEach((input, index) => {
        // Check if the input is referencing an entry module input
        const entryInputs = modules.entry as string[];
        const entryInputIndex = entryInputs.indexOf(input);
        
        if (entryInputIndex !== -1) {
          // Connection from entry module with arbitrary input name
          edges.push({
            id: `entry-${input}-to-${moduleName}-${index}`,
            source: 'entry',
            target: moduleName,
            sourceHandle: `output-${entryInputIndex}`,
            targetHandle: `input-${index}`,
            data: {
              label: input
            }
          });
        } else {
          // Connection from another module
          const [sourceName, sourceOutput] = parseInputSource(input);
          
          edges.push({
            id: `${sourceName}${sourceOutput ? `:${sourceOutput}` : ''}-to-${moduleName}-${index}`,
            source: sourceName,
            target: moduleName,
            sourceHandle: sourceOutput !== undefined ? `output-${sourceOutput}` : undefined,
            targetHandle: `input-${index}`,
            data: {
              label: input
            }
          });
        }
      });
    }
  });
  
  // Apply layout algorithm
  const { nodes: positionedNodes } = applyLayout({ nodes, edges });
  
  return {
    nodes: positionedNodes,
    edges
  };
};

/**
 * Parse an input source string into module name and output index
 * @param inputSource - Input source string (e.g., "module1:0", "module2")
 * @returns Tuple of [moduleName, outputIndex?]
 */
const parseInputSource = (inputSource: string): [string, number | undefined] => {
  const parts = inputSource.split(':');
  
  if (parts.length === 1) {
    return [parts[0], undefined];
  }
  
  return [parts[0], parseInt(parts[1], 10)];
};

/**
 * Apply layout algorithm to position nodes
 * @param network - Network structure with nodes and edges
 * @returns Network structure with positioned nodes
 */
export const applyLayout = (network: NetworkStructure): NetworkStructure => {
  const { nodes, edges } = network;
  
  // Create a new graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: HORIZONTAL_SPACING, ranksep: VERTICAL_SPACING });
  g.setDefaultEdgeLabel(() => ({}));
  
  // Add nodes to the graph
  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  
  // Add edges to the graph
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });
  
  // Apply the layout
  dagre.layout(g);
  
  // Get the positioned nodes
  const positionedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2
      }
    };
  });
  
  return {
    nodes: positionedNodes,
    edges
  };
};
