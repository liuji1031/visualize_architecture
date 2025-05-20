import dagre from 'dagre';
import { YamlConfig, NetworkStructure, YamlModule } from '../types';

// Constants for layout (Exported)
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 100; // Height might be more relevant now
export const HORIZONTAL_SPACING = 30; // Spacing between nodes in the same rank (horizontal)
export const VERTICAL_SPACING = 0; // Spacing between ranks (vertical)

/**
 * Process the YAML configuration into a network structure for ReactFlow
 * @param config - Parsed YAML configuration
 * @returns Network structure with nodes and edges
 */
export const processNetworkStructure = (config: YamlConfig): NetworkStructure => {
  const { modules } = config;
  
  // Process nodes
  const nodes = Object.entries(modules).map(([moduleName, moduleData]) => {
    const isInput = moduleName === 'input';
    const isOutput = moduleName === 'output';
    
    // Handle different module data formats
    let cls: string | undefined;
    let module_type: string | undefined; // Added module_type
    let outNum = 1;
    let inputSources: string[] | Record<string, string> | undefined;
    let configData: Record<string, any> | string | undefined; // Renamed to avoid conflict with config var name
    
    if (isInput) {
      // Input module has inputs directly as an array
      inputSources = moduleData as string[];
    } else if (isOutput) {
      // Output module has outputs directly as a record
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
      type: isInput ? 'input' : isOutput ? 'output' : 'default',
      position: { x: 0, y: 0 }, // Will be calculated by layout algorithm
      data: {
        label: moduleName,
        cls,
        module_type, // Add module_type to node data
        isInput,
        isOutput,
        outNum,
        inputSources, // Include input sources information
        config: configData // Use renamed variable
      }
    };
  });
  
  // Process edges
  const edges: NetworkStructure['edges'] = [];
  
  Object.entries(modules).forEach(([moduleName, moduleData]) => {
    if (moduleName === 'input') {
      // Skip input module as it doesn't have real connections
      return;
    }
    
    if (moduleName === 'output') {
      // Handle output module which can have inputs as either a list or a dictionary
      if (Array.isArray(moduleData)) {
        // Output module has inputs as a list
        const outputInputs = moduleData as string[];
        
        outputInputs.forEach((inputSource, index) => {
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
        // Output module has inputs as a dictionary
        const outputInputs = moduleData as Record<string, string>;
        
        Object.entries(outputInputs).forEach(([outputName, inputSource]) => {
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
        // Check if the input is referencing an input module input
        const inputInputs = modules.input as string[];
        const inputInputIndex = inputInputs.indexOf(input);
        
        if (inputInputIndex !== -1) {
          // Connection from input module with arbitrary input name
          edges.push({
            id: `input-${input}-to-${moduleName}-${index}`,
            source: 'input',
            target: moduleName,
            sourceHandle: `output-${inputInputIndex}`,
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
 * Compute a point on a cubic Bezier curve at parameter t (0 <= t <= 1)
 * @param p0 - Start point {x, y}
 * @param p1 - First control point {x, y}
 * @param p2 - Second control point {x, y}
 * @param p3 - End point {x, y}
 * @param t - Parameter (0=start, 1=end)
 * @returns {x, y} point on the curve
 */
export function cubicBezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const x =
    Math.pow(1 - t, 3) * p0.x +
    3 * Math.pow(1 - t, 2) * t * p1.x +
    3 * (1 - t) * Math.pow(t, 2) * p2.x +
    Math.pow(t, 3) * p3.x;
  const y =
    Math.pow(1 - t, 3) * p0.y +
    3 * Math.pow(1 - t, 2) * t * p1.y +
    3 * (1 - t) * Math.pow(t, 2) * p2.y +
    Math.pow(t, 3) * p3.y;
  return { x, y };
}

/**
 * Parse an input source string into module name and output index
 * @param inputSource - Input source string (e.g., "module1:0", "module2")
 * @returns Tuple of [moduleName, outputIndex?]
 */
const parseInputSource = (inputSource: string): [string, number | undefined] => {
  const parts = inputSource.split('.'); // Changed delimiter from ':' to '.'
  
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
  // Set layout direction to Top-to-Bottom ('TB') and adjust spacing
  g.setGraph({ rankdir: 'TB', nodesep: HORIZONTAL_SPACING, ranksep: VERTICAL_SPACING });
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
