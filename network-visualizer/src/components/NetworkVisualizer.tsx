import React, { useState, useCallback, useRef, useEffect, Fragment } from 'react';
import JSZip from 'jszip';
import ReactFlow, {
  ReactFlowProvider,
  Controls,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  EdgeTypes,
  MarkerType,
  useReactFlow,
  Node,
  Edge,
  XYPosition, // Added for potential future use, good practice
  // Removed NodeMouseEvent import, will use type inference later
  NodeChange, // Needed for onNodesChange
  applyNodeChanges, // Needed for onNodesChange
  EdgeChange, // Needed for onEdgesChange
  applyEdgeChanges, // Needed for onEdgesChange
} from 'reactflow';
import 'reactflow/dist/style.css';

import { YamlConfig, ModuleNodeData } from '../types';
import { 
  parseYamlContent, 
  uploadYamlFile, 
  fetchYamlFile, 
  checkYamlReferences, 
  ReferencesResponse,
  uploadYamlFolder,
  UploadFolderOptions
} from '../services/api';
import { processNetworkStructure } from '../utils/networkProcessor';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const edgeTypes: EdgeTypes = {
  custom: CustomEdge,
};

interface NetworkVisualizerProps {
  yamlContent?: string;
  yamlUrl?: string;
}

const NetworkVisualizer: React.FC<NetworkVisualizerProps> = ({ yamlContent, yamlUrl }) => {
  // Removed useNodesState and useEdgesState hooks
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showFolderDialog, setShowFolderDialog] = useState<boolean>(false);
  const [mainFile, setMainFile] = useState<string>('');
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // State for managing graph history (stack)
  type GraphState = { nodes: Node[]; edges: Edge[]; config?: YamlConfig }; // Added optional config
  const [historyStack, setHistoryStack] = useState<GraphState[]>([]);
  const [currentGraphIndex, setCurrentGraphIndex] = useState<number>(-1);
  // Cache for generated subgraphs to avoid re-computation
  const [subgraphCache, setSubgraphCache] = useState<Record<string, GraphState>>({});
  // Removed currentConfig state as it's now part of GraphState

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reactFlowInstance = useReactFlow();

  // Handle window resize events
  useEffect(() => {
    // Create a debounced resize handler
    let resizeTimeout: NodeJS.Timeout | null = null;
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = setTimeout(() => {
        if (reactFlowInstance) {
          // Use fitView with duration to make the transition smoother
          reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
        }
      }, 300);
    };
    
    // Add resize event listener
    window.addEventListener('resize', handleResize);
    
    // Remove event listener when component unmounts
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    };
  }, [reactFlowInstance]);

  // Define basic node/edge change handlers
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges]
  );

  // Helper function to create custom nodes/edges (moved from previous attempt)
  const createGraphElements = (config: YamlConfig): { nodes: Node[], edges: Edge[] } => {
    const { nodes: processedNodes, edges: processedEdges } = processNetworkStructure(config);
    
    const customNodes = processedNodes.map((node) => ({
      ...node,
      type: 'custom',
      hidden: false, // Ensure nodes are visible by default
    }));
    
    const customEdges = processedEdges.map((edge) => ({
      ...edge,
      type: 'custom',
      hidden: false, // Ensure edges are visible by default
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: '#555',
      },
    }));
    
    return { nodes: customNodes, edges: customEdges };
  };
  
  // Process the YAML configuration and update the visualization
  const processConfig = useCallback((config: YamlConfig, isInitialLoad: boolean = true) => { // Added isInitialLoad flag
    try {
      setError(null);

      const { nodes: newNodes, edges: newEdges } = createGraphElements(config);
      const newGraphState: GraphState = { nodes: newNodes, edges: newEdges, config };

      if (isInitialLoad) {
        // Reset history and cache for a new file/content load
        setHistoryStack([newGraphState]);
        setCurrentGraphIndex(0);
        setSubgraphCache({});
        setNodes(newNodes); // Set initial nodes
        setEdges(newEdges); // Set initial edges
      } else {
        // This case handles pushing a new subgraph onto the stack (used by double-click)
        
        // Hide the current graph's elements before adding the new one
        // Note: We modify the *current* state's nodes/edges, not the ones in the stack directly
        setNodes(nds => nds.map(n => ({ ...n, hidden: true })));
        setEdges(eds => eds.map(e => ({ ...e, hidden: true })));

        // Add the new graph state to the stack
        const newStack = [...historyStack.slice(0, currentGraphIndex + 1), newGraphState];
        setHistoryStack(newStack);
        const newIndex = newStack.length - 1;
        setCurrentGraphIndex(newIndex);

        // Add the new nodes/edges to the existing (now hidden) ones
        // Use functional updates to ensure we're working with the latest state
        setNodes(nds => [...nds, ...newNodes]); 
        setEdges(eds => [...eds, ...newEdges]);
      }

      // Use a timeout to ensure nodes are properly rendered before fitting view
      setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
        }
      }, 300);

      return newGraphState; // Return the newly created state for caching

    } catch (err) {
      setError(`Error processing network structure: ${(err as Error).message}`);
      console.error('Error processing network structure:', err);
      return null; // Return null on error
    }
  // Corrected dependencies for processConfig
  }, [reactFlowInstance, setNodes, setEdges, historyStack, currentGraphIndex, setHistoryStack, setCurrentGraphIndex, setSubgraphCache]); 

  // Load YAML content if provided
  useEffect(() => {
    if (yamlContent) {
      // Parse the YAML content via the backend API
      parseYamlContent(yamlContent)
        .then(config => processConfig(config, true)) // Ensure initial load
        .catch((err) => {
          setError(`Error parsing YAML content: ${err.message}`);
          console.error('Error parsing YAML content:', err);
        });
    }
  }, [yamlContent, processConfig]);
  
  // Fetch YAML from URL if provided
  useEffect(() => {
    if (yamlUrl) {
      // Fetch and parse the YAML file
      fetchYamlFile(yamlUrl)
        .then(config => processConfig(config, true)) // Ensure initial load
        .catch((err) => {
          setError(`Error fetching YAML from URL: ${err.message}`);
          console.error('Error fetching YAML from URL:', err);
        });
    }
  }, [yamlUrl, processConfig]);

  // Upload and process the file (moved before handleFileChange)
  const uploadAndProcessFile = useCallback((file: File, autoUploadReferences: boolean, isInitial: boolean = true) => { // Added isInitial flag
    setFile(file);
    
    // Upload and process the file via the backend API
    uploadYamlFile(file, autoUploadReferences)
      .then(config => processConfig(config, isInitial)) // Pass isInitial
      .catch((err) => {
        setError(`Error processing YAML file: ${err.message}`);
        console.error('Error processing YAML file:', err);
      });
  }, [processConfig, setError, setFile]); // Added dependencies
  
  // Handle single file selection
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFile = files[0];
      setSelectedFile(newFile);
      
      // Upload the file directly without checking references
      uploadAndProcessFile(newFile, false, true); // Ensure initial load
    }
  }, [uploadAndProcessFile]); 
  
  // Handle folder selection
  const handleFolderChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      try {
        // Create a zip file from the selected files
        const zip = new JSZip();
        const fileList: string[] = [];
        
        // Add each file to the zip
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relativePath = file.webkitRelativePath;
          fileList.push(relativePath);
          zip.file(relativePath, file);
        }
        
        // Generate the zip file
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipBlob], 'folder.zip', { type: 'application/zip' });
        
        // Set the zip file and folder files
        setZipFile(zipFile);
        setFolderFiles(fileList);
        
        // Show the folder dialog to select the main file
        setShowFolderDialog(true);
      } catch (err) {
        setError(`Error processing folder: ${(err as Error).message}`);
        console.error('Error processing folder:', err);
      }
    }
  // Corrected dependencies for handleFolderChange
  }, [setError, setZipFile, setFolderFiles, setShowFolderDialog]); 
  
  // Handle file upload button click 
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  
  // Handle folder upload button click
  const handleUploadFolderClick = useCallback(() => {
    folderInputRef.current?.click();
  }, []);
  
  // Handle folder dialog confirmation
  const handleConfirmFolder = useCallback(() => {
    setShowFolderDialog(false);
    
    if (zipFile && mainFile) {
      // Upload the folder
      uploadYamlFolder({ zipFile, mainFile })
        .then(config => processConfig(config, true)) // Ensure initial load
        .catch((err) => {
          setError(`Error processing YAML folder: ${err.message}`);
          console.error('Error processing YAML folder:', err);
        });
    }
  // Corrected dependencies for handleConfirmFolder
  }, [zipFile, mainFile, processConfig, setError, setShowFolderDialog]); 
  
  // Handle folder dialog cancellation
  const handleCancelFolder = useCallback(() => {
    setShowFolderDialog(false);
    setZipFile(null);
    setFolderFiles([]);
    setMainFile('');
  // Corrected dependencies for handleCancelFolder
  }, [setShowFolderDialog, setZipFile, setFolderFiles, setMainFile]); 
  
  // Handle edge connection
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'custom',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 15,
              height: 15,
              color: '#555',
            },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Handle "Go Back" button click
  const handleGoBack = useCallback(() => {
    if (currentGraphIndex > 0) {
      const previousIndex = currentGraphIndex - 1;
      const previousGraphState = historyStack[previousIndex];

      // Hide all currently visible nodes/edges before switching
      // Note: This assumes nodes/edges from different levels are all in the state array
      setNodes(nds => nds.map(n => ({ ...n, hidden: true })));
      setEdges(eds => eds.map(e => ({ ...e, hidden: true })));

      // Unhide the nodes/edges of the previous graph state
      // We need to find these specific nodes/edges in the current state array and unhide them.
      const previousNodeIds = new Set(previousGraphState.nodes.map(n => n.id));
      const previousEdgeIds = new Set(previousGraphState.edges.map(e => e.id));

      setNodes(nds => nds.map(n => previousNodeIds.has(n.id) ? { ...n, hidden: false } : n));
      setEdges(eds => eds.map(e => previousEdgeIds.has(e.id) ? { ...e, hidden: false } : e));
      
      // Update the current index
      setCurrentGraphIndex(previousIndex);

      // Fit view for the previous graph
      setTimeout(() => {
        if (reactFlowInstance) {
          // Fit view might need adjustment if nodes were added/removed, 
          // but for now, just fit to the currently visible ones.
          reactFlowInstance.fitView({ padding: 0.2, duration: 800 }); 
        }
      }, 300);
    }
  }, [currentGraphIndex, historyStack, setNodes, setEdges, setCurrentGraphIndex, reactFlowInstance]);

  // Handle node double-click for expanding ComposableModels
  const onNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: Node<ModuleNodeData>) => {
      // Check if it's a ComposableModel with a config
      if (node.type === 'custom' && node.data?.module_type === 'ComposableModel' && node.data?.config) {
        const subgraphConfig = node.data.config as YamlConfig; // Type assertion
        const cacheKey = node.id; // Use node ID as the cache key

        // Check if this subgraph is already cached
        if (subgraphCache[cacheKey]) {
          console.log(`Using cached subgraph for node ${node.id}`);
          const cachedState = subgraphCache[cacheKey];

          // Hide current graph elements
          setNodes(nds => nds.map(n => ({ ...n, hidden: true })));
          setEdges(eds => eds.map(e => ({ ...e, hidden: true })));

          // Add the cached (visible) elements
          setNodes(nds => [...nds, ...cachedState.nodes.map(n => ({ ...n, hidden: false }))]);
          setEdges(eds => [...eds, ...cachedState.edges.map(e => ({ ...e, hidden: false }))]);

          // Update history stack
          const newStack = [...historyStack.slice(0, currentGraphIndex + 1), cachedState];
          setHistoryStack(newStack);
          const newIndex = newStack.length - 1;
          setCurrentGraphIndex(newIndex);

          // Fit view after state update
          setTimeout(() => {
            if (reactFlowInstance) {
              reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
            }
          }, 300);

        } else {
          console.log(`Generating new subgraph for node ${node.id}`);
          // Not cached, process the config to generate and display the subgraph
          // Pass false for isInitialLoad to trigger history push and hiding logic
          const newlyGeneratedState = processConfig(subgraphConfig, false);

          // Cache the newly generated state if it was created successfully
          if (newlyGeneratedState) {
             setSubgraphCache(cache => ({ 
               ...cache, 
               [cacheKey]: newlyGeneratedState 
             }));
          }
        }
      }
    },
    [
      processConfig, 
      subgraphCache, 
      setNodes, 
      setEdges, 
      historyStack, 
      currentGraphIndex, 
      setHistoryStack,
      setCurrentGraphIndex,
      reactFlowInstance,
      setSubgraphCache 
    ]
  );
  
  // Reset the view to fit all nodes
  const resetView = useCallback(() => {
    setTimeout(() => {
      if (reactFlowInstance) {
        reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
      }
    }, 300);
  }, [reactFlowInstance]);
  
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick} // Pass the handler
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable
        elementsSelectable
      >
        <Background />
        <Controls />
        
        <Panel position="top-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".yaml,.yml"
              onChange={handleFileChange}
            />
            <input
              type="file"
              ref={folderInputRef}
              style={{ display: 'none' }}
              // @ts-ignore - webkitdirectory and directory are non-standard attributes
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderChange}
            />
            <button
              onClick={handleUploadClick}
              style={{
                padding: '8px 12px',
                backgroundColor: '#4a90e2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Upload YAML File
            </button>
            <button
              onClick={handleUploadFolderClick}
              style={{
                padding: '8px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Upload Folder
            </button>
            <button
              onClick={resetView}
              style={{
                padding: '8px 12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Reset View
            </button>
            {/* Add Go Back button, only visible when not at the root level */}
            {currentGraphIndex > 0 && (
              <button
                onClick={handleGoBack}
                style={{
                  marginTop: '10px', // Add some space
                  padding: '8px 12px',
                  backgroundColor: '#ffc107', // Use a distinct color
                  color: 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Go Back
              </button>
            )}
          </div>
        </Panel>
        
        {error && (
          <Panel position="top-center">
            <div
              style={{
                padding: '10px',
                backgroundColor: '#f8d7da',
                color: '#721c24',
                borderRadius: '4px',
                border: '1px solid #f5c6cb',
              }}
            >
              {error}
            </div>
          </Panel>
        )}
        
        {file && (
          <Panel position="top-right">
            <div
              style={{
                padding: '10px',
                backgroundColor: '#e2f3f5',
                borderRadius: '4px',
                border: '1px solid #90cdf4',
              }}
            >
              <strong>Current File:</strong> {file.name}
            </div>
          </Panel>
        )}
        
        {/* Folder Dialog */}
        {showFolderDialog && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: 'white',
                padding: '20px',
                borderRadius: '8px',
                maxWidth: '600px',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
            >
              <h3 style={{ marginTop: 0 }}>Select Main YAML File</h3>
              <p>
                Please select the main YAML file to process from the uploaded folder.
              </p>
              
              <div style={{ marginBottom: '20px' }}>
                <select
                  value={mainFile}
                  onChange={(e) => setMainFile(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                  }}
                >
                  <option value="">-- Select a file --</option>
                  {folderFiles
                    .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
                    .map((file, index) => (
                      <option key={index} value={file}>{file}</option>
                    ))
                  }
                </select>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={handleCancelFolder}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmFolder}
                  disabled={!mainFile}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: mainFile ? '#4a90e2' : '#cccccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: mainFile ? 'pointer' : 'not-allowed',
                  }}
                >
                  Process
                </button>
              </div>
            </div>
          </div>
        )}
      </ReactFlow>
    </div>
  );
};

// Wrap the component with ReactFlowProvider and pass the onNodeDoubleClick prop to CustomNode
const NetworkVisualizerWrapper: React.FC<NetworkVisualizerProps> = (props) => {
  return (
    <ReactFlowProvider>
      <NetworkVisualizer {...props} />
    </ReactFlowProvider>
  );
};

export default NetworkVisualizerWrapper;
