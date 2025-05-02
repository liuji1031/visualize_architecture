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
  NodeChange, // Needed for onNodesChange (provided by hook)
  EdgeChange, // Needed for onEdgesChange (provided by hook)
  EdgeProps, // Add EdgeProps import
} from 'reactflow';
import 'reactflow/dist/style.css';

import { YamlConfig, ModuleNodeData, ModuleEdgeData } from '../types'; // Add ModuleEdgeData import
import {
  parseYamlContent,
  uploadYamlFile,
  fetchYamlFile,
  getSubgraphConfig,
  checkYamlReferences,
  ReferencesResponse,
  uploadYamlFolder,
  UploadFolderOptions,
  cleanupUpload, // Renamed import
  UploadResponse // Import UploadResponse type
} from '../services/api';
import { processNetworkStructure, NODE_WIDTH, HORIZONTAL_SPACING } from '../utils/networkProcessor';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';

// Create a context for edge label visibility
export const EdgeLabelContext = createContext<boolean>(true);

interface NetworkVisualizerProps {
  yamlContent?: string;
  yamlUrl?: string;
}

const NetworkVisualizer: React.FC<NetworkVisualizerProps> = ({ yamlContent, yamlUrl }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showFolderDialog, setShowFolderDialog] = useState<boolean>(false);
  const [mainFile, setMainFile] = useState<string>('');
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(false); // Default to false
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null); // State for upload ID

  type GraphState = { nodes: Node[]; edges: Edge[]; config?: YamlConfig };
  const [historyStack, setHistoryStack] = useState<GraphState[]>([]);
  const [currentGraphIndex, setCurrentGraphIndex] = useState<number>(-1);
  const [subgraphCache, setSubgraphCache] = useState<Record<string, GraphState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reactFlowInstance = useReactFlow();

  // Simple edgeTypes mapping
  const edgeTypes: EdgeTypes = {
    custom: CustomEdge,
  };

  // Handle toggle for edge labels
  const toggleEdgeLabels = useCallback(() => {
    setShowEdgeLabels(prev => !prev);
  }, []);

  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
        }
      }, 300);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [reactFlowInstance]);

  const createGraphElements = (config: YamlConfig): { nodes: Node[], edges: Edge[] } => {
    const { nodes: processedNodes, edges: processedEdges } = processNetworkStructure(config);
    const customNodes = processedNodes.map((node) => ({ ...node, type: 'custom', hidden: false }));
    const customEdges = processedEdges.map((edge) => ({
      ...edge, type: 'custom', hidden: false, markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#555' },
    }));
    return { nodes: customNodes, edges: customEdges };
  };

  const processConfig = useCallback((
    config: YamlConfig,
    isInitialLoad: boolean = true,
    parentNodePosition?: XYPosition
  ) => {
    try {
      setError(null);
      let { nodes: newNodes, edges: newEdges } = createGraphElements(config);
      if (!isInitialLoad && parentNodePosition) {
        const offsetX = parentNodePosition.x + NODE_WIDTH + HORIZONTAL_SPACING / 2;
        const offsetY = parentNodePosition.y;
        newNodes = newNodes.map(node => ({ ...node, position: { x: node.position.x + offsetX, y: node.position.y + offsetY }, hidden: false }));
        newEdges = newEdges.map(edge => ({ ...edge, hidden: false }));
      } else {
        newNodes = newNodes.map(node => ({ ...node, hidden: false }));
        newEdges = newEdges.map(edge => ({ ...edge, hidden: false }));
      }
      const newGraphState: GraphState = { nodes: newNodes, edges: newEdges, config };
      if (isInitialLoad) {
        setHistoryStack([newGraphState]);
        setCurrentGraphIndex(0);
        setSubgraphCache({});
        setNodes(newNodes);
        setEdges(newEdges);
        setTimeout(() => { if (reactFlowInstance) reactFlowInstance.fitView({ padding: 0.2, duration: 800 }); }, 300);
      }
      return newGraphState;
    } catch (err: any) {
      setError(`Error processing network structure: ${err.message}`);
      console.error('Error processing network structure:', err);
      return null;
    }
  }, [reactFlowInstance, setNodes, setEdges, setHistoryStack, setCurrentGraphIndex, setSubgraphCache]);

  useEffect(() => {
    if (yamlContent) {
      parseYamlContent(yamlContent)
        .then(config => processConfig(config, true))
        .catch((err: any) => { setError(`Error parsing YAML content: ${err.message}`); console.error('Error parsing YAML content:', err); });
    }
  }, [yamlContent, processConfig]);

  useEffect(() => {
    if (yamlUrl) {
      fetchYamlFile(yamlUrl)
        .then((config: YamlConfig) => processConfig(config, true))
        .catch((err: any) => { setError(`Error fetching YAML from URL: ${err.message}`); console.error('Error fetching YAML from URL:', err); });
    }
  }, [yamlUrl, processConfig]);

  // Updated uploadAndProcessFile to handle UploadResponse
  const uploadAndProcessFile = useCallback((file: File, isInitial: boolean = true) => {
    setFile(file);
    uploadYamlFile(file)
      .then((response: UploadResponse) => {
        setCurrentUploadId(response.uploadId); // Store the upload ID
        processConfig(response.config, isInitial); // Process the config
      })
      .catch((err: any) => {
        setError(`Error processing YAML file: ${err.message}`);
        console.error('Error processing YAML file:', err);
        setCurrentUploadId(null); // Clear upload ID on error
      });
  }, [processConfig, setError, setFile, setCurrentUploadId]);

  const calculateDynamicPadding = (nodeCount: number): number => {
    const basePadding = 0.2;
    if (nodeCount <= 5) return basePadding;
    if (nodeCount <= 10) return basePadding + 0.1;
    if (nodeCount <= 20) return basePadding + 0.2;
    return basePadding + 0.3;
  };

  const calculateTransitionDuration = (nodeCount: number): number => {
    const baseDuration = 600;
    if (nodeCount <= 5) return baseDuration;
    if (nodeCount <= 10) return baseDuration + 200;
    if (nodeCount <= 20) return baseDuration + 400;
    return baseDuration + 600;
  };

  // Updated handleNodeDoubleClick to pass currentUploadId
  const handleNodeDoubleClick = useCallback(async (nodeId: string, configPath: string, moduleName: string = '') => {
    setError(null);
    const parentNode = reactFlowInstance.getNode(nodeId);
    if (!parentNode) { setError(`Node ${nodeId} not found.`); return; }
    const nodeModuleName = moduleName || (parentNode.data?.label || 'ComposableModel');
    reactFlowInstance.fitView({ nodes: [{ id: nodeId }], padding: 0.3, duration: 500 });
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      const subgraphConfig = await getSubgraphConfig(currentUploadId, configPath, nodeModuleName); // Pass currentUploadId
      // Simplified logic - always process subgraph, don't rely on cache across uploads
      const newlyGeneratedState = processConfig(subgraphConfig, false, parentNode.position);
      if (newlyGeneratedState) {
        const newStack = [...historyStack.slice(0, currentGraphIndex + 1), newlyGeneratedState];
        setHistoryStack(newStack);
        const newIndex = newStack.length - 1;
        setCurrentGraphIndex(newIndex);
        setNodes(newlyGeneratedState.nodes);
        setEdges(newlyGeneratedState.edges);
        setTimeout(() => {
          const nodeCount = newlyGeneratedState.nodes.length;
          const padding = calculateDynamicPadding(nodeCount);
          const duration = calculateTransitionDuration(nodeCount);
          reactFlowInstance.fitView({ nodes: newlyGeneratedState.nodes.map(n => ({ id: n.id })), padding: padding, duration: duration });
          setTimeout(() => { reactFlowInstance.fitView({ padding: padding, duration: duration / 2 }); }, 500);
        }, 200);
      } else {
        setError(`Failed to process subgraph config from ${configPath}`);
      }
    } catch (err: any) {
      const errorMessage = (err as Error).message;
      if (errorMessage.startsWith('CONFIG_FILE_NOT_FOUND:')) {
        const parts = errorMessage.split(':');
        const configFilePath = parts[1];
        const modName = parts[2] || nodeModuleName;
        const customErrorMsg = `The configuration file ${configFilePath} for ${modName} is not found, please upload as a folder.`;
        setError(customErrorMsg); console.error(customErrorMsg);
      } else {
        const errorMsg = `Error loading/processing subgraph from ${configPath}: ${errorMessage}`;
        setError(errorMsg); console.error(errorMsg, err);
      }
      setTimeout(() => { if (parentNode) reactFlowInstance.fitView({ nodes: [{ id: nodeId }], padding: 0.3, duration: 500 }); }, 300);
    }
  }, [
    reactFlowInstance, processConfig, currentUploadId, // Added currentUploadId
    historyStack, currentGraphIndex, setHistoryStack, setCurrentGraphIndex, setNodes, setEdges, setError
  ]);

  // Updated handleFileChange to include cleanup
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFile = files[0];
      setSelectedFile(newFile);
      cleanupUpload(currentUploadId).finally(() => { // Cleanup previous upload
        setCurrentUploadId(null);
        uploadAndProcessFile(newFile, true);
      });
    }
  }, [uploadAndProcessFile, currentUploadId, setCurrentUploadId]);

  // Updated handleFolderChange to include cleanup
  const handleFolderChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await cleanupUpload(currentUploadId); // Cleanup previous upload
      setCurrentUploadId(null);
      try {
        const zip = new JSZip();
        const fileList: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relativePath = file.webkitRelativePath;
          fileList.push(relativePath);
          zip.file(relativePath, file);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFile = new File([zipBlob], 'folder.zip', { type: 'application/zip' });
        setZipFile(zipFile);
        setFolderFiles(fileList);
        setShowFolderDialog(true);
      } catch (err: any) {
        setError(`Error processing folder: ${err.message}`);
        console.error('Error processing folder:', err);
      }
    }
  }, [setError, setZipFile, setFolderFiles, setShowFolderDialog, currentUploadId, setCurrentUploadId]);

  // Updated handleUploadClick - cleanup is now in handleFileChange
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Updated handleUploadFolderClick - cleanup is now in handleFolderChange
  const handleUploadFolderClick = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  // Updated handleConfirmFolder to handle UploadResponse
  const handleConfirmFolder = useCallback(() => {
    setShowFolderDialog(false);
    if (zipFile && mainFile) {
      uploadYamlFolder({ zipFile, mainFile })
        .then((response: UploadResponse) => {
          setCurrentUploadId(response.uploadId);
          processConfig(response.config, true);
        })
        .catch((err: any) => {
          setError(`Error processing YAML folder: ${err.message}`);
          console.error('Error processing YAML folder:', err);
          setCurrentUploadId(null);
        });
    }
  }, [zipFile, mainFile, processConfig, setError, setShowFolderDialog, setCurrentUploadId]);

  const handleCancelFolder = useCallback(() => {
    setShowFolderDialog(false);
    setZipFile(null);
    setFolderFiles([]);
    setMainFile('');
  }, [setShowFolderDialog, setZipFile, setFolderFiles, setMainFile]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'custom', markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#555' } }, eds));
    }, [setEdges]
  );

  const handleGoBack = useCallback(() => {
    if (currentGraphIndex > 0) {
      const previousIndex = currentGraphIndex - 1;
      const previousGraphState = historyStack[previousIndex];
      setNodes(previousGraphState.nodes);
      setEdges(previousGraphState.edges);
      setCurrentGraphIndex(previousIndex);
      setTimeout(() => {
        if (reactFlowInstance) {
          const nodeCount = previousGraphState.nodes.length;
          const padding = calculateDynamicPadding(nodeCount);
          const duration = calculateTransitionDuration(nodeCount);
          reactFlowInstance.fitView({ padding: padding, duration: duration });
          setTimeout(() => { reactFlowInstance.fitView({ padding: padding, duration: duration / 2 }); }, 500);
        }
      }, 300);
    }
  }, [currentGraphIndex, historyStack, setNodes, setEdges, setCurrentGraphIndex, reactFlowInstance]);

  const resetView = useCallback(() => {
    setTimeout(() => {
      if (reactFlowInstance) {
        const nodeCount = nodes.length;
        const padding = calculateDynamicPadding(nodeCount);
        const duration = calculateTransitionDuration(nodeCount);
        reactFlowInstance.fitView({ padding: padding, duration: duration });
      }
    }, 300);
  }, [reactFlowInstance, nodes]);

  const nodeTypes: NodeTypes = React.useMemo(() => ({
    custom: (props) => <CustomNode {...props} onNodeDoubleClick={handleNodeDoubleClick} />,
  }), [handleNodeDoubleClick]);

  return (
    <EdgeLabelContext.Provider value={showEdgeLabels}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes} // Use the simple mapping
          nodesDraggable
          elementsSelectable
        >
          <Background />
          <Controls />
          <Panel position="top-left">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".yaml,.yml" onChange={handleFileChange} />
              {/* @ts-ignore - webkitdirectory and directory are non-standard attributes */}
              <input type="file" ref={folderInputRef} style={{ display: 'none' }} webkitdirectory="" directory="" multiple onChange={handleFolderChange} />
              <button onClick={handleUploadClick} style={{ padding: '8px 12px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upload YAML File</button>
              <button onClick={handleUploadFolderClick} style={{ padding: '8px 12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upload Folder</button>
              <button onClick={resetView} style={{ padding: '8px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reset View</button>
              {currentGraphIndex > 0 && (
                <button onClick={handleGoBack} style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Go Back</button>
              )}
              {/* Add checkbox for edge labels */}
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f0f0f0', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc' }}>
                <input type="checkbox" id="edge-labels-toggle" checked={showEdgeLabels} onChange={toggleEdgeLabels} style={{ marginRight: '8px' }} />
                <label htmlFor="edge-labels-toggle" style={{ fontSize: '14px', cursor: 'pointer' }}>Show Edge Labels</label>
              </div>
            </div>
          </Panel>
          {error && (
            <Panel position="top-center"><div style={{ padding: '10px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', border: '1px solid #f5c6cb' }}>{error}</div></Panel>
          )}
          {file && (
            <Panel position="top-right"><div style={{ padding: '10px', backgroundColor: '#e2f3f5', borderRadius: '4px', border: '1px solid #90cdf4' }}><strong>Current File:</strong> {file.name}</div></Panel>
          )}
          {showFolderDialog && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
              <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', maxWidth: '600px', maxHeight: '80vh', overflow: 'auto' }}>
                <h3 style={{ marginTop: 0 }}>Select Main YAML File</h3>
                <p>Please select the main YAML file to process from the uploaded folder.</p>
                <div style={{ marginBottom: '20px' }}>
                  <select value={mainFile} onChange={(e) => setMainFile(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                    <option value="">-- Select a file --</option>
                    {folderFiles.filter(file => file.endsWith('.yaml') || file.endsWith('.yml')).map((file, index) => (<option key={index} value={file}>{file}</option>))}
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button onClick={handleCancelFolder} style={{ padding: '8px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={handleConfirmFolder} disabled={!mainFile} style={{ padding: '8px 12px', backgroundColor: mainFile ? '#4a90e2' : '#cccccc', color: 'white', border: 'none', borderRadius: '4px', cursor: mainFile ? 'pointer' : 'not-allowed' }}>Process</button>
                </div>
              </div>
            </div>
          )}
        </ReactFlow>
      </div>
    </EdgeLabelContext.Provider>
  );
};

const NetworkVisualizerWrapper: React.FC<NetworkVisualizerProps> = (props) => {
  return (
    <ReactFlowProvider>
      <NetworkVisualizer {...props} />
    </ReactFlowProvider>
  );
};

export default NetworkVisualizerWrapper;
