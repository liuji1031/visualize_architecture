// Type definitions for the neural network architecture visualization

// YAML Module Definition
export interface YamlModule {
  cls?: string;
  inp_src?: string[] | Record<string, string>;
  out_num?: number;
  config?: Record<string, any> | string;
}

// YAML Configuration
export interface YamlConfig {
  modules: Record<string, YamlModule | string[] | Record<string, string>>;
}

// Node Data for ReactFlow
export interface ModuleNodeData {
  label: string;
  cls?: string;
  isEntry?: boolean;
  isExit?: boolean;
  module_type?: string; // Added to store the type like 'ComposableModel'
  outNum?: number;
  inputSources?: string[] | Record<string, string>; // Add input sources information
  config?: Record<string, any> | string; // Configuration parameters for the module or path to config file
}

// Edge Data for ReactFlow
export interface ModuleEdgeData {
  label: string;
  sourceHandle?: string;
  targetHandle?: string;
}

// Processed Network Structure
export interface NetworkStructure {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: ModuleNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    data?: ModuleEdgeData;
  }>;
}
