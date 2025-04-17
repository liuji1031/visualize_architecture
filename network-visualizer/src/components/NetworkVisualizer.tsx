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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showFolderDialog, setShowFolderDialog] = useState<boolean>(false);
  const [mainFile, setMainFile] = useState<string>('');
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  const [currentConfig, setCurrentConfig] = useState<YamlConfig | null>(null);
  
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
  
  // Process the YAML configuration and update the visualization
  const processConfig = useCallback((config: YamlConfig) => {
    try {
      setError(null);
      setCurrentConfig(config);
      
      // Process the network structure
      const { nodes: processedNodes, edges: processedEdges } = processNetworkStructure(config);
      
      // Update the nodes with custom type
      const customNodes = processedNodes.map((node) => ({
        ...node,
        type: 'custom',
      }));
      
      // Update the edges with custom type and marker end
      const customEdges = processedEdges.map((edge) => ({
        ...edge,
        type: 'custom',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: '#555',
        },
      }));
      
      // Set the nodes and edges
      setNodes(customNodes);
      setEdges(customEdges);
      
      // Use a timeout to ensure nodes are properly rendered before fitting view
      setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
        }
      }, 300);
    } catch (err) {
      setError(`Error processing network structure: ${(err as Error).message}`);
      console.error('Error processing network structure:', err);
    }
  }, [reactFlowInstance, setNodes, setEdges]);
  
  // Load YAML content if provided
  useEffect(() => {
    if (yamlContent) {
      // Parse the YAML content via the backend API
      parseYamlContent(yamlContent)
        .then(processConfig)
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
        .then(processConfig)
        .catch((err) => {
          setError(`Error fetching YAML from URL: ${err.message}`);
          console.error('Error fetching YAML from URL:', err);
        });
    }
  }, [yamlUrl, processConfig]);
  
  // Handle single file selection
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFile = files[0];
      setSelectedFile(newFile);
      
      // Upload the file directly without checking references
      uploadAndProcessFile(newFile, false);
    }
  }, []);
  
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
  }, []);
  
  // Upload and process the file
  const uploadAndProcessFile = useCallback((file: File, autoUploadReferences: boolean) => {
    setFile(file);
    
    // Upload and process the file via the backend API
    uploadYamlFile(file, autoUploadReferences)
      .then(processConfig)
      .catch((err) => {
        setError(`Error processing YAML file: ${err.message}`);
        console.error('Error processing YAML file:', err);
      });
  }, [processConfig]);
  
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
        .then(processConfig)
        .catch((err) => {
          setError(`Error processing YAML folder: ${err.message}`);
          console.error('Error processing YAML folder:', err);
        });
    }
  }, [zipFile, mainFile, processConfig]);
  
  // Handle folder dialog cancellation
  const handleCancelFolder = useCallback(() => {
    setShowFolderDialog(false);
    setZipFile(null);
    setFolderFiles([]);
    setMainFile('');
  }, []);
  
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
