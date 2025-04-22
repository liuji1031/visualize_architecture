import React, { useState, useCallback, useRef, useEffect, Fragment, createContext, useContext } from 'react'; // Added createContext, useContext
import JSZip from 'jszip';
import ReactFlow, {
  ReactFlowProvider,
  Controls,
  Background,
  Panel,
  useNodesState, // Reintroduced
  useEdgesState, // Reintroduced
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
  NodeChange, // Needed for onNodesChange (provided by hook)
  // applyNodeChanges, // No longer needed directly if using hook's handler
  EdgeChange, // Needed for onEdgesChange (provided by hook)
  // applyEdgeChanges, // No longer needed directly if using hook's handler
  EdgeProps, // Add EdgeProps import
} from 'reactflow';
import 'reactflow/dist/style.css';

// Reintroduce useNodesState and useEdgesState (Comment redundant)
import { YamlConfig, ModuleNodeData, ModuleEdgeData } from '../types'; // Add ModuleEdgeData import
import { 
  parseYamlContent,
  uploadYamlFile,
  fetchYamlFile, // Uncomment this import
  getSubgraphConfig, // Import the new function
  checkYamlReferences,
  ReferencesResponse,
  uploadYamlFolder,
  UploadFolderOptions,
  cleanupTempDirectory
} from '../services/api';
// Import layout constants
import { processNetworkStructure, NODE_WIDTH, HORIZONTAL_SPACING } from '../utils/networkProcessor';
import CustomNode from './CustomNode'; // Ensure CustomNode is imported
import CustomEdge from './CustomEdge';

// Create a context for edge label visibility
export const EdgeLabelContext = createContext<boolean>(true);

interface NetworkVisualizerProps {
  yamlContent?: string;
  yamlUrl?: string;
}

const NetworkVisualizer: React.FC<NetworkVisualizerProps> = ({ yamlContent, yamlUrl }) => {
  // Reintroduce useNodesState and useEdgesState hooks
  const [nodes, setNodes, onNodesChange] = useNodesState([]); // Use hook
  const [edges, setEdges, onEdgesChange] = useEdgesState([]); // Use hook
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showFolderDialog, setShowFolderDialog] = useState<boolean>(false);
  const [mainFile, setMainFile] = useState<string>('');
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(true); // State for toggle

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

  // Revert edgeTypes definition to simple mapping
  const edgeTypes: EdgeTypes = {
    custom: CustomEdge,
  };

  // Handle toggle for edge labels
  const toggleEdgeLabels = useCallback(() => {
    setShowEdgeLabels(prev => !prev);
  }, []);

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

  // onNodesChange and onEdgesChange are now provided by the hooks

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
  // Added parentNodePosition optional parameter
  const processConfig = useCallback((
    config: YamlConfig, 
    isInitialLoad: boolean = true, 
    parentNodePosition?: XYPosition 
  ) => { 
    try {
      setError(null);

      // 1. Generate subgraph elements (positions are relative to subgraph)
      let { nodes: newNodes, edges: newEdges } = createGraphElements(config);
      
      // 2. Apply offset if expanding a node (not initial load)
      if (!isInitialLoad && parentNodePosition) {
        // Simple offset: Place subgraph to the right of the parent node
        // TODO: A more sophisticated approach might calculate the bounding box 
        // of newNodes and center it relative to the parent.
        // Use imported constants
        const offsetX = parentNodePosition.x + NODE_WIDTH + HORIZONTAL_SPACING / 2; 
        const offsetY = parentNodePosition.y; 

        newNodes = newNodes.map(node => ({
          ...node,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          },
          hidden: false, // Ensure new nodes are visible
        }));
        // Ensure new edges are also visible
        newEdges = newEdges.map(edge => ({ ...edge, hidden: false }));
      } else {
         // Ensure nodes/edges are visible on initial load too
         newNodes = newNodes.map(node => ({ ...node, hidden: false }));
         newEdges = newEdges.map(edge => ({ ...edge, hidden: false }));
      }

      // 3. Create the new graph state with *offset* nodes
      const newGraphState: GraphState = { nodes: newNodes, edges: newEdges, config };

      if (isInitialLoad) {
        // Reset history and cache for a new file/content load
        setHistoryStack([newGraphState]);
        setCurrentGraphIndex(0);
        setSubgraphCache({});
        setNodes(newNodes); // Set initial nodes using hook setter
        setEdges(newEdges); // Set initial edges using hook setter
        
        // Initial fitView call after setting initial nodes/edges
        setTimeout(() => {
          if (reactFlowInstance) {
            reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
          }
        }, 300);

      } 
      // NOTE: The 'else' block for handling expansion state updates is removed.
      // State updates (setNodes/setEdges) will now happen directly in onNodeDoubleClick.
      // processConfig now primarily focuses on generating the *target* graph state.

      // Removed the fitView call from here. View centering/fitting is handled elsewhere.

      return newGraphState; // Return the newly created state for caching

    } catch (err) {
      setError(`Error processing network structure: ${(err as Error).message}`);
      console.error('Error processing network structure:', err);
      return null; // Return null on error
    }
      // Corrected dependencies for processConfig
  }, [reactFlowInstance, setNodes, setEdges, historyStack, currentGraphIndex, setHistoryStack, setCurrentGraphIndex, setSubgraphCache]); // setNodes/setEdges from hook

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
        .then((config: YamlConfig) => processConfig(config, true)) // Add YamlConfig type
        .catch((err: unknown) => { // Add unknown type for error
          // Type guard to access error message safely
          const message = err instanceof Error ? err.message : String(err);
          setError(`Error fetching YAML from URL: ${message}`);
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

  // Helper function to calculate dynamic padding based on node count
  const calculateDynamicPadding = (nodeCount: number): number => {
    // Base padding of 0.2 for small graphs
    const basePadding = 0.2;
    
    // Increase padding for larger graphs, but cap it at a reasonable value
    if (nodeCount <= 5) return basePadding;
    if (nodeCount <= 10) return basePadding + 0.1;
    if (nodeCount <= 20) return basePadding + 0.2;
    return basePadding + 0.3; // Max padding for very large graphs
  };

  // Helper function to calculate transition duration based on complexity
  const calculateTransitionDuration = (nodeCount: number): number => {
    // Base duration of 600ms
    const baseDuration = 600;
    
    // Increase duration for larger graphs to make transitions smoother
    if (nodeCount <= 5) return baseDuration;
    if (nodeCount <= 10) return baseDuration + 200;
    if (nodeCount <= 20) return baseDuration + 400;
    return baseDuration + 600; // Max duration for very large graphs
  };

  // *** IMPROVED: Handler for double-clicking ComposableModel nodes with config paths ***
  const handleNodeDoubleClick = useCallback(async (nodeId: string, configPath: string, moduleName: string = '') => {
    console.log(`Double-clicked ComposableModel node ${nodeId} with config path: ${configPath}`);
    setError(null); // Clear previous errors

    const parentNode = reactFlowInstance.getNode(nodeId);
    if (!parentNode) {
      console.error(`Node ${nodeId} not found.`);
      setError(`Node ${nodeId} not found.`);
      return;
    }

    // Get the module name from the node data if not provided
    const nodeModuleName = moduleName || (parentNode.data?.label || 'ComposableModel');

    // Center view on the clicked node *before* fetching/processing
    // Use a slightly longer duration for the initial centering
    reactFlowInstance.fitView({ nodes: [{ id: nodeId }], padding: 0.3, duration: 500 });

    // Use a longer delay to allow fitView animation to complete
    await new Promise(resolve => setTimeout(resolve, 200)); 

    try {
      // Use the new getSubgraphConfig function which works with the session context
      console.log(`Getting subgraph config from relative path: ${configPath}`);
      // Pass the relative path (configPath) and module name to the new API function
      const subgraphConfig = await getSubgraphConfig(configPath, nodeModuleName);
      console.log('Fetched subgraph config:', subgraphConfig);

      const cacheKey = `${nodeId}-${configPath}`; // Cache key remains the same

      // Check cache first
      if (subgraphCache[cacheKey]) {
        console.log(`Using cached subgraph for key ${cacheKey}`);
        const cachedState = subgraphCache[cacheKey];

        // Update history stack
        const newStack = [...historyStack.slice(0, currentGraphIndex + 1), cachedState];
        setHistoryStack(newStack);
        const newIndex = newStack.length - 1;
        setCurrentGraphIndex(newIndex);
        
        // Directly set state to the cached subgraph
        setNodes(cachedState.nodes); 
        setEdges(cachedState.edges); 

        // Calculate dynamic padding and duration based on node count
        const nodeCount = cachedState.nodes.length;
        const padding = calculateDynamicPadding(nodeCount);
        const duration = calculateTransitionDuration(nodeCount);

        // Fit view to the cached subgraph nodes after state update with increased timeout
        setTimeout(() => {
          console.log(`Centering view on ${nodeCount} nodes with padding ${padding} and duration ${duration}ms`);
          reactFlowInstance.fitView({ 
            nodes: cachedState.nodes.map(n => ({ id: n.id })), 
            padding: padding, 
            duration: duration 
          });
          
          // Add a fallback centering mechanism with a longer delay
          setTimeout(() => {
            reactFlowInstance.fitView({ 
              padding: padding, 
              duration: duration / 2 
            });
          }, 500);
        }, 200); // Increased from 0ms to 200ms

      } else {
        console.log(`Generating new subgraph for key ${cacheKey}`);
        // Not cached, process the fetched config
        const newlyGeneratedState = processConfig(subgraphConfig, false, parentNode.position);

        if (newlyGeneratedState) {
          // Cache the newly generated state
          setSubgraphCache(cache => ({ 
            ...cache, 
            [cacheKey]: newlyGeneratedState 
          }));
          
          // Update history stack
          const newStack = [...historyStack.slice(0, currentGraphIndex + 1), newlyGeneratedState];
          setHistoryStack(newStack);
          const newIndex = newStack.length - 1;
          setCurrentGraphIndex(newIndex);

          // Directly set state to the new subgraph
          setNodes(newlyGeneratedState.nodes); 
          setEdges(newlyGeneratedState.edges); 

          // Calculate dynamic padding and duration based on node count
          const nodeCount = newlyGeneratedState.nodes.length;
          const padding = calculateDynamicPadding(nodeCount);
          const duration = calculateTransitionDuration(nodeCount);

          // Fit view to the newly generated subgraph nodes after state update with increased timeout
          setTimeout(() => {
            console.log(`Centering view on ${nodeCount} nodes with padding ${padding} and duration ${duration}ms`);
            reactFlowInstance.fitView({ 
              nodes: newlyGeneratedState.nodes.map(n => ({ id: n.id })), 
              padding: padding, 
              duration: duration 
            });
            
            // Add a fallback centering mechanism with a longer delay
            setTimeout(() => {
              reactFlowInstance.fitView({ 
                padding: padding, 
                duration: duration / 2 
              });
            }, 500);
          }, 200); // Increased from 0ms to 200ms
        } else {
           setError(`Failed to process subgraph config from ${configPath}`);
        }
      }
    } catch (err) {
      // Check if this is a CONFIG_FILE_NOT_FOUND error
      const errorMessage = (err as Error).message;
      if (errorMessage.startsWith('CONFIG_FILE_NOT_FOUND:')) {
        // Parse the error message to get the config path and module name
        const parts = errorMessage.split(':');
        const configFilePath = parts[1];
        const moduleName = parts[2] || nodeModuleName;
        
        // Set the custom error message
        const customErrorMsg = `The configuration file ${configFilePath} for ${moduleName} is not found, please upload as a folder.`;
        setError(customErrorMsg);
        console.error(customErrorMsg);
      } else {
        // Handle other errors
        const errorMsg = `Error loading/processing subgraph from ${configPath}: ${(err as Error).message}`;
        setError(errorMsg);
        console.error(errorMsg, err);
      }
      
      // Revert fitView to show the original node if there's an error
      setTimeout(() => {
        if (parentNode) {
          reactFlowInstance.fitView({ 
            nodes: [{ id: nodeId }], 
            padding: 0.3, 
            duration: 500 
          });
        }
      }, 300);
    }
  }, [
    reactFlowInstance, 
    processConfig, 
    subgraphCache, 
    setNodes, 
    setEdges, 
    historyStack, 
    currentGraphIndex, 
    setHistoryStack, 
    setCurrentGraphIndex, 
    setSubgraphCache,
    setError // Added setError dependency
  ]);
  
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
    // Clean up the temp directory before uploading a new file
    cleanupTempDirectory()
      .then(() => {
        console.log('Temporary directory cleaned up successfully');
        fileInputRef.current?.click();
      })
      .catch((err) => {
        console.error('Error cleaning up temporary directory:', err);
        // Continue with file upload even if cleanup fails
        fileInputRef.current?.click();
      });
  }, []);
  
  // Handle folder upload button click
  const handleUploadFolderClick = useCallback(() => {
    // Clean up the temp directory before uploading a new folder
    cleanupTempDirectory()
      .then(() => {
        console.log('Temporary directory cleaned up successfully');
        folderInputRef.current?.click();
      })
      .catch((err) => {
        console.error('Error cleaning up temporary directory:', err);
        // Continue with folder upload even if cleanup fails
        folderInputRef.current?.click();
      });
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
    [setEdges] // setEdges from hook
  );

  // Handle "Go Back" button click
  const handleGoBack = useCallback(() => {
    if (currentGraphIndex > 0) {
      const previousIndex = currentGraphIndex - 1;
      const previousGraphState = historyStack[previousIndex];
      
      // Directly replace state with the previous graph's elements
      setNodes(previousGraphState.nodes); // Use hook setter
      setEdges(previousGraphState.edges); // Use hook setter
      
      // Update the current index
      setCurrentGraphIndex(previousIndex);

      // Fit view for the previous graph
      setTimeout(() => {
        if (reactFlowInstance) {
          // Calculate dynamic padding based on node count
          const nodeCount = previousGraphState.nodes.length;
          const padding = calculateDynamicPadding(nodeCount);
          const duration = calculateTransitionDuration(nodeCount);
          
          // Use dynamic padding and duration for smoother transitions
          reactFlowInstance.fitView({ 
            padding: padding, 
            duration: duration 
          }); 
          
          // Add a fallback centering with a longer delay
          setTimeout(() => {
            reactFlowInstance.fitView({ 
              padding: padding, 
              duration: duration / 2 
            });
          }, 500);
        }
      }, 300);
    }
  }, [currentGraphIndex, historyStack, setNodes, setEdges, setCurrentGraphIndex, reactFlowInstance]); // setNodes/setEdges from hook

  // *** REMOVED old onNodeDoubleClick handler that expanded based on embedded config object ***
  
  // Reset the view to fit all nodes
  const resetView = useCallback(() => {
    setTimeout(() => {
      if (reactFlowInstance) {
        // Calculate dynamic padding based on node count
        const nodeCount = nodes.length;
        const padding = calculateDynamicPadding(nodeCount);
        const duration = calculateTransitionDuration(nodeCount);
        
        reactFlowInstance.fitView({ 
          padding: padding, 
          duration: duration 
        });
      }
    }, 300);
  }, [reactFlowInstance, nodes]);

  // Define nodeTypes, wrapping CustomNode to pass the double-click handler
  const nodeTypes: NodeTypes = React.useMemo(() => ({
    custom: (props) => <CustomNode {...props} onNodeDoubleClick={handleNodeDoubleClick} />,
  }), [handleNodeDoubleClick]); // Recompute only if the handler changes
  
  return (
    <EdgeLabelContext.Provider value={showEdgeLabels}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange} // Use handler from hook
          onEdgesChange={onEdgesChange} // Use handler from hook
          onConnect={onConnect}
          // onNodeDoubleClick prop is removed - handled internally by CustomNode now
          nodeTypes={nodeTypes} // Use the memoized nodeTypes with the handler
          edgeTypes={edgeTypes} // Use the simple edgeTypes mapping
          // Removed fitView prop to rely on manual fitView calls
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
              {/* Add checkbox for edge labels */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#f0f0f0',
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}>
                <input
                  type="checkbox"
                  id="edge-labels-toggle"
                  checked={showEdgeLabels}
                  onChange={toggleEdgeLabels}
                  style={{ marginRight: '8px' }}
                />
                <label htmlFor="edge-labels-toggle" style={{ fontSize: '14px', cursor: 'pointer' }}>
                  Show Edge Labels
                </label>
              </div>
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
    </EdgeLabelContext.Provider>
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
