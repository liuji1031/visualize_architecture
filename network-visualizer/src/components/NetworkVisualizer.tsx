import React, { useState, useCallback, useRef, useEffect, Fragment, createContext, useContext } from 'react'; // Added createContext, useContext
import JSZip from 'jszip';
import ReactFlow, {
  ReactFlowProvider,
  Controls,
  Background,
  MiniMap, // Import MiniMap
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
  getNodesBounds, // Import helper function (updated from getRectOfNodes)
  Viewport, // Import Viewport type
  PanelPosition, // Import PanelPosition for type safety
} from 'reactflow';
import { toPng, toSvg } from 'html-to-image'; // Import SVG export function as well
import 'reactflow/dist/style.css';
import { Tooltip } from 'react-tooltip'; // Import Tooltip
import 'react-tooltip/dist/react-tooltip.css'; // Import Tooltip CSS

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
  UploadResponse, // Import UploadResponse type
  cropImage, // Import cropImage function
  listPresetConfigurations,
  loadPresetConfiguration,
  API_BASE_URL // Import API_BASE_URL
} from '../services/api';
import { processNetworkStructure, NODE_WIDTH, HORIZONTAL_SPACING } from '../utils/networkProcessor';
import { getNodeBackgroundColor, nodeTypeStyles } from '../utils/colorUtils'; // Import color utils
import CustomNode from './CustomNode';
// import CustomEdge from './CustomEdge'; // No longer needed if using default types
import ModifiedBezierEdge from './ModifiedBezierEdge'; // Import the new custom edge

// Create a context for edge label visibility
export const EdgeLabelContext = createContext<boolean>(true);

interface NetworkVisualizerProps {
  yamlContent?: string;
  yamlUrl?: string;
  currentModelPath: string; // Added
  onModelPathChange: (newPath: string) => void; // Added
}

// Define zoom constraints as constants
const MIN_ZOOM_LEVEL = 0.25;
const MAX_ZOOM_LEVEL = 1.0;

const NetworkVisualizer: React.FC<NetworkVisualizerProps> = ({ 
  yamlContent, 
  yamlUrl, 
  currentModelPath, // Destructure here
  onModelPathChange // Destructure here
}) => {
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
  const [showUI, setShowUI] = useState<boolean>(true); // Control UI visibility during export
  const [showBackground, setShowBackground] = useState<boolean>(true); // Control background visibility during export
  const [presets, setPresets] = useState<string[]>([]); // Available preset configurations
  const [isLoadingPresets, setIsLoadingPresets] = useState<boolean>(false); // Loading state for presets
  const [selectedPreset, setSelectedPreset] = useState<string>(""); // Selected preset
  const [isGeneratingGraph, setIsGeneratingGraph] = useState<boolean>(false); // State for graph generation
  
  // Add triggerNodeId and fullPath to track which node was clicked and the model path
  type GraphState = { nodes: Node[]; edges: Edge[]; config?: YamlConfig; triggerNodeId?: string; fullPath?: string }; 
  const [historyStack, setHistoryStack] = useState<GraphState[]>([]);
  const [currentGraphIndex, setCurrentGraphIndex] = useState<number>(-1);
  const [subgraphCache, setSubgraphCache] = useState<Record<string, GraphState>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null); // Ref for the container div
  const reactFlowInstance = useReactFlow();

  // Register the new custom edge type
  const edgeTypes: EdgeTypes = {
    modifiedBezier: ModifiedBezierEdge,
    // Keep smoothstep as a built-in type
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

  const arrowWidth = 20;
  const arrowHeight = 20;

  // Simplified createGraphElements to always use modifiedBezier
  const createGraphElements = (config: YamlConfig): { nodes: Node[], edges: Edge[] } => {
    const { nodes: processedNodes, edges: processedEdges } = processNetworkStructure(config);
    const customNodes = processedNodes.map((node) => ({ ...node, type: 'custom', hidden: false }));
    const customEdges = processedEdges.map((edge) => ({
      ...edge,
      type: 'modifiedBezier', // Always use modifiedBezier
      hidden: false,
      style: { strokeWidth: 1.5, stroke: '#555', fill: 'none' }, // Explicit edge style
      markerEnd: { 
        type: MarkerType.ArrowClosed, 
        width: arrowWidth, 
        height: arrowHeight, 
        color: '#555',
        strokeWidth: 1 // Ensure marker has stroke width
      },
    }));
    return { nodes: customNodes, edges: customEdges };
  };

  // Simplified processConfig to not require edgeType parameter
  // Add triggerNodeId parameter
  const processConfig = useCallback((
    config: YamlConfig,
    initialModelName: string, // Added to pass the determined model name
    isInitialLoad: boolean = true,
    parentNodePosition?: XYPosition,
    triggerNodeId?: string
  ) => {
    setIsGeneratingGraph(true);
    try {
      setError(null);
      // No need to pass edgeType anymore
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
  // Assign triggerNodeId and fullPath to the state if provided
  let newGraphState: GraphState = { nodes: newNodes, edges: newEdges, config, triggerNodeId };
  
  if (isInitialLoad) {
    // initialModelName is now passed in, use it directly for fullPath
    newGraphState = { ...newGraphState, fullPath: initialModelName };
    // onModelPathChange is called by the initiator of the load (e.g., handleFileChange)
    // So, no need to call onModelPathChange(initialModelName) here again.

    setHistoryStack([newGraphState]);
    setCurrentGraphIndex(0);
    setSubgraphCache({});
    setNodes(newNodes);
    setEdges(newEdges);
    // Implement single-step initial view logic
        setTimeout(() => {
          if (reactFlowInstance && reactFlowWrapper.current && newNodes.length > 0) {
            const padding = 0.2; // Same padding as fitView uses
            const topPadding = 50;
            const bottomPadding = 50;

            const bounds = getNodesBounds(newNodes);
            const flowDimensions = reactFlowWrapper.current.getBoundingClientRect();
            const viewportWidth = flowDimensions.width;
            const viewportHeight = flowDimensions.height;

            // Calculate zoom level needed to fit bounds within viewport + padding
            const zoomX = viewportWidth / (bounds.width * (1 + padding * 2));
            const zoomY = viewportHeight / (bounds.height * (1 + padding * 2));
            let targetZoom = Math.min(zoomX, zoomY);

            // Apply zoom constraints
            targetZoom = Math.max(targetZoom, 0.8);
            targetZoom = Math.min(targetZoom, MAX_ZOOM_LEVEL);

            // Find the actual topmost node
            const topmostNode = newNodes.reduce((top, node) => (node.position.y < top.position.y ? node : top), newNodes[0]);

            // Calculate target X for horizontal centering at targetZoom
            const targetX = (viewportWidth - bounds.width * targetZoom) / 2 - bounds.x * targetZoom;

            // Calculate target Y to align top node below topPadding at targetZoom
            const targetY_topAligned = topPadding - (topmostNode.position.y * targetZoom);

            // Calculate where the bottom of the graph would be if top-aligned at targetZoom
            const graphBottomScreenY = targetY_topAligned + (bounds.height * targetZoom);

            let finalTargetY = targetY_topAligned; // Default to top-aligned

            // Check if the entire graph fits vertically at the target zoom
            if (graphBottomScreenY < viewportHeight - bottomPadding) {
              // It fits, so calculate Y to center it vertically
              const verticalCenterOffset = (viewportHeight - bounds.height * targetZoom) / 2;
              finalTargetY = verticalCenterOffset - (bounds.y * targetZoom);
            }
            // Else: It doesn't fit, keep finalTargetY as targetY_topAligned

            // Apply the final calculated viewport with a single call
            reactFlowInstance.setViewport(
              { x: targetX, y: finalTargetY, zoom: targetZoom },
              { duration: 800 } // Use the longer duration for the single animation
            );
          }
        }, 300); // Delay slightly to ensure nodes are rendered
      }
      return newGraphState;
    } catch (err: any) {
      setError(`Error processing network structure: ${err.message}`);
      console.error('Error processing network structure:', err);
      return null;
    } finally {
      setIsGeneratingGraph(false);
    }
  }, [reactFlowInstance, setNodes, setEdges, setHistoryStack, setCurrentGraphIndex, setSubgraphCache, setIsGeneratingGraph]);

  useEffect(() => {
    if (yamlContent) {
      setIsGeneratingGraph(true);
      const modelName = "Loaded Model"; // Generic name for direct content
      onModelPathChange(modelName);
      parseYamlContent(yamlContent)
        .then(config => processConfig(config, modelName, true))
        .catch((err: any) => {
          setError(`Error parsing YAML content: ${err.message}`);
          console.error('Error parsing YAML content:', err);
          setIsGeneratingGraph(false);
        });
      // processConfig will set isGeneratingGraph to false in its finally block
    }
  }, [yamlContent, processConfig, setIsGeneratingGraph]);

  // Fetch available presets on component mount
  useEffect(() => {
    const fetchPresets = async () => {
      try {
        console.log('NetworkVisualizer: Starting to fetch preset configurations...');
        setIsLoadingPresets(true);
        
        // Check if API_BASE_URL is accessible
        console.log('NetworkVisualizer: Checking API connectivity...');
        try {
          const testResponse = await fetch(`${API_BASE_URL}/yaml/list-presets`, { 
            method: 'HEAD',
            cache: 'no-store' // Bypass cache
          });
          console.log(`NetworkVisualizer: API connectivity test result: ${testResponse.status} ${testResponse.statusText}`);
        } catch (connectError) {
          console.error('NetworkVisualizer: API connectivity test failed:', connectError);
        }
        
        console.log('NetworkVisualizer: Calling listPresetConfigurations()...');
        const presetList = await listPresetConfigurations();
        
        console.log(`NetworkVisualizer: Setting ${presetList.length} presets to state`);
        setPresets(presetList);
        console.log(`NetworkVisualizer: Loaded ${presetList.length} preset configurations:`, presetList);
      } catch (err: any) {
        console.error('NetworkVisualizer: Error fetching preset configurations:', err);
        // Don't show error to user, just log it
        setError(`Failed to load preset configurations. Check console for details.`);
      } finally {
        console.log('NetworkVisualizer: Finished preset loading process');
        setIsLoadingPresets(false);
      }
    };
    
    fetchPresets();
  }, []);

  useEffect(() => {
    if (yamlUrl) {
      setIsGeneratingGraph(true);
      const baseName = yamlUrl.substring(yamlUrl.lastIndexOf('/') + 1).replace(/\.(yaml|yml)$/i, '') || "URL Model";
      onModelPathChange(baseName);
      fetchYamlFile(yamlUrl)
        .then((config: YamlConfig) => processConfig(config, baseName, true))
        .catch((err: any) => {
          setError(`Error fetching YAML from URL: ${err.message}`);
          console.error('Error fetching YAML from URL:', err);
          setIsGeneratingGraph(false);
        });
      // processConfig will set isGeneratingGraph to false in its finally block
    }
  }, [yamlUrl, processConfig, setIsGeneratingGraph]);

  // Updated uploadAndProcessFile to handle UploadResponse and pass edgeType correctly
  const uploadAndProcessFile = useCallback((fileToUpload: File, isInitial: boolean = true) => {
    setFile(fileToUpload); // Use a different name to avoid conflict with 'file' state
    setIsGeneratingGraph(true);
    const baseName = fileToUpload.name.replace(/\.(yaml|yml)$/i, '');
    if(isInitial) onModelPathChange(baseName);

    uploadYamlFile(fileToUpload)
      .then((response: UploadResponse) => {
        setCurrentUploadId(response.uploadId); // Store the upload ID
        processConfig(response.config, baseName, isInitial); // Pass baseName
      })
      .catch((err: any) => {
        setError(`Error processing YAML file: ${err.message}`);
        console.error('Error processing YAML file:', err);
        setCurrentUploadId(null); // Clear upload ID on error
        setIsGeneratingGraph(false);
      });
  }, [processConfig, setError, setFile, setCurrentUploadId, setIsGeneratingGraph]);

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
      
      // For subgraphs, the 'initialModelName' for processConfig isn't strictly the root, 
      // but it's used to set fullPath if it were an initial load (which it isn't here).
      // The actual newFullPath is constructed below.
      const tempModelNameForProcessConfig = nodeModuleName; // Or parentNode.data.label
      const newlyGeneratedState = processConfig(subgraphConfig, tempModelNameForProcessConfig, false, parentNode.position, nodeId); 

      if (newlyGeneratedState) {
        let newFullPath = currentModelPath; 
        if (moduleName) { 
          newFullPath = `${currentModelPath}/${moduleName}`;
          onModelPathChange(newFullPath); 
        }
        
        // Ensure the fullPath in the new state reflects the navigation
        const stateWithFullPath = { ...newlyGeneratedState, fullPath: newFullPath }; 
        const newStack = [...historyStack.slice(0, currentGraphIndex + 1), stateWithFullPath];
        setHistoryStack(newStack);
        const newIndex = newStack.length - 1;
        setCurrentGraphIndex(newIndex);
        setNodes(stateWithFullPath.nodes); // Use nodes from stateWithFullPath
        setEdges(stateWithFullPath.edges); // Use edges from stateWithFullPath
        setTimeout(() => {
          const nodeCount = stateWithFullPath.nodes.length;
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
    reactFlowInstance, processConfig, currentUploadId,
    historyStack, currentGraphIndex, setHistoryStack, setCurrentGraphIndex, setNodes, setEdges, setError,
    currentModelPath, onModelPathChange // Added props dependencies
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

  // Updated handleUploadClick -cleanu isis niwCehandleFChne
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Updated handleUploadFolderClick - cleanup is now in handleFolderChange
  const handleUploadFolderClick = useCallback(() => {
    folderInputRef.current?.click();
  }, []);
  
  // Handle preset selection change
  const handlePresetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetName = e.target.value;
    console.log(`NetworkVisualizer: Preset selection changed to: "${presetName}"`);
    setSelectedPreset(presetName);
    
    if (presetName) {
      setError(null);
      setIsGeneratingGraph(true);
      console.log(`NetworkVisualizer: Starting to load preset: "${presetName}"`);
      
      // Clean up previous upload if any
      console.log(`NetworkVisualizer: Cleaning up previous upload ID: ${currentUploadId}`);
      cleanupUpload(currentUploadId).finally(() => {
        setCurrentUploadId(null);
        
        // Load the selected preset
        console.log(`NetworkVisualizer: Calling loadPresetConfiguration for "${presetName}"...`);
        loadPresetConfiguration(presetName)
          .then((response: UploadResponse) => {
            console.log(`NetworkVisualizer: Successfully loaded preset "${presetName}" with upload ID: ${response.uploadId}`);
            setCurrentUploadId(response.uploadId);
            onModelPathChange(presetName); // Set path for preset
            processConfig(response.config, presetName, true); // Pass presetName
            setFile(null); // Clear the file state since we're using a preset
          })
          .catch((err: any) => {
            const errorMsg = `Error loading preset '${presetName}': ${err.message}`;
            console.error(`NetworkVisualizer: ${errorMsg}`, err);
            setError(errorMsg);
            setCurrentUploadId(null);
            setIsGeneratingGraph(false);
          });
      });
    } else {
      // If no preset is selected (e.g., "-- Select a configuration --"), ensure loading is false
      setIsGeneratingGraph(false);
    }
  }, [currentUploadId, processConfig, setError, setFile, setCurrentUploadId, setIsGeneratingGraph]);

  // Updated handleConfirmFolder to handle UploadResponse
  const handleConfirmFolder = useCallback(() => {
    setShowFolderDialog(false);
    if (zipFile && mainFile) {
      setIsGeneratingGraph(true);
      const baseName = mainFile.substring(mainFile.lastIndexOf('/') + 1).replace(/\.(yaml|yml)$/i, '');
      onModelPathChange(baseName);

      uploadYamlFolder({ zipFile, mainFile })
        .then((response: UploadResponse) => {
          setCurrentUploadId(response.uploadId);
          processConfig(response.config, baseName, true); // Pass baseName
        })
        .catch((err: any) => {
          setError(`Error processing YAML folder: ${err.message}`);
          console.error('Error processing YAML folder:', err);
          setCurrentUploadId(null);
          setIsGeneratingGraph(false);
        });
    }
  }, [zipFile, mainFile, processConfig, setError, setShowFolderDialog, setCurrentUploadId, setIsGeneratingGraph]);

  const handleCancelFolder = useCallback(() => {
    setShowFolderDialog(false);
    setZipFile(null);
    setFolderFiles([]);
    setMainFile('');
  }, [setShowFolderDialog, setZipFile, setFolderFiles, setMainFile]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ 
        ...connection, 
        type: 'modifiedBezier', // Always use modifiedBezier
        style: { strokeWidth: 1.5, stroke: '#555', fill: 'none' }, // Explicit edge style
        markerEnd: { 
          type: MarkerType.ArrowClosed, 
          width: arrowWidth, 
          height: arrowHeight, 
          color: '#555',
          strokeWidth: 1 // Ensure marker has stroke width
        } 
      }, eds));
    }, [setEdges]
  );

  const handleGoBack = useCallback(() => {
    if (currentGraphIndex > 0) {
      const currentState = historyStack[currentGraphIndex]; 
      const triggerNodeId = currentState.triggerNodeId; 

      const previousIndex = currentGraphIndex - 1;
      const previousGraphState = historyStack[previousIndex];
      
      setNodes(previousGraphState.nodes);
      setEdges(previousGraphState.edges);
      setCurrentGraphIndex(previousIndex);

      // Update model path using the stored fullPath from the previous state
      if (previousGraphState.fullPath) {
        onModelPathChange(previousGraphState.fullPath);
      } else if (previousGraphState.config) {
        // Fallback if fullPath somehow wasn't set.
        // We don't have a reliable 'name' on config, so we might need a default
        // or reconstruct from history if possible, but for now, this is a safety net.
        // This case should ideally not be hit if fullPath is always set.
        const fallbackPath = historyStack.slice(0, previousIndex + 1)
                               .map(s => s.config?.modules ? Object.keys(s.config.modules)[0] : 'unknown') // very rough guess
                               .join('/');
        onModelPathChange(fallbackPath || "Model");
      }


      // Center on the trigger node if it exists
      setTimeout(() => {
        if (reactFlowInstance) {
          if (triggerNodeId && previousGraphState.nodes.some(n => n.id === triggerNodeId)) {
            reactFlowInstance.fitView({ nodes: [{ id: triggerNodeId }], padding: 0.3, duration: 800 });
          } else {
            const nodeCount = previousGraphState.nodes.length;
            const padding = calculateDynamicPadding(nodeCount);
            const duration = calculateTransitionDuration(nodeCount);
            reactFlowInstance.fitView({ padding: padding, duration: duration });
          }
        }
      }, 300); 
    }
  }, [currentGraphIndex, historyStack, setNodes, setEdges, setCurrentGraphIndex, reactFlowInstance, onModelPathChange]);

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

  // Handle SVG export specifically in the frontend
  const handleSvgExport = useCallback((filename: string) => {
    try {
      if (!reactFlowInstance) {
        throw new Error('ReactFlow instance not available');
      }
  
      // Get nodes and edges from ReactFlow instance
      const flowNodes = reactFlowInstance.getNodes();
      const flowEdges = reactFlowInstance.getEdges();
      
      if (flowNodes.length === 0 && flowEdges.length === 0) {
        throw new Error('No nodes or edges to export');
      }
      
      // Define handle radius as a constant for consistent use
      const HANDLE_RADIUS = 4;
      
      // Get the bounding box using getNodesBounds
      const bounds = getNodesBounds(flowNodes);
      
      // Add padding to create a padded bounding box
      const padding = 0;
      const paddedBounds = {
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + (padding * 2),
        height: bounds.height + (padding * 2)
      };
      
      // Use these values for both the SVG dimensions and viewBox
      const width = paddedBounds.width;
      const height = paddedBounds.height;

      const arrowWidth = 6;
      const arrowHeight = 8;
      
      // Create SVG document with proper XML declaration
      const svgString = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
  <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${paddedBounds.x} ${paddedBounds.y} ${paddedBounds.width} ${paddedBounds.height}">
    <defs>
      <!-- Define marker for arrow heads -->
      <marker id="arrowhead" markerWidth="${arrowWidth}" markerHeight="${arrowHeight}" refX="0" refY="${arrowHeight/2}" orient="auto">
        <polygon points="0 0, ${arrowWidth} ${arrowHeight/2}, 0 ${arrowHeight}" fill="#555" />
      </marker>
    </defs>
    <rect x="${paddedBounds.x}" y="${paddedBounds.y}" width="${paddedBounds.width}" height="${paddedBounds.height}" fill="white"/>
    <g class="edges">
      ${flowEdges.map(edge => {
        const sourceNode = flowNodes.find(n => n.id === edge.source);
        const targetNode = flowNodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) return '';
        // Get source and target handle information
        const sourceHandleId = edge.sourceHandle || 'output-0';
        const targetHandleId = edge.targetHandle || 'input-0';
        // Parse handle indices
        const sourceHandleIndex = parseInt(sourceHandleId.split('-')[1]) || 0;
        const targetHandleIndex = parseInt(targetHandleId.split('-')[1]) || 0;
        // Calculate source handle position
        const sourceWidth = sourceNode.width || 150;
        const sourceHeight = sourceNode.height || 40;
        let sourceHandleX;
        let sourceOutputCount = sourceNode.data.outNum || 1;
        if (sourceNode.data.isInput && Array.isArray(sourceNode.data.inputSources)) {
          sourceOutputCount = sourceNode.data.inputSources.length;
        }
        if (sourceOutputCount === 1) {
          sourceHandleX = sourceNode.position.x + sourceWidth / 2;
        } else {
          const leftPadding = 20;
          const rightPadding = 20;
          const availableWidth = sourceWidth - leftPadding - rightPadding;
          const step = availableWidth / (sourceOutputCount - 1);
          sourceHandleX = sourceNode.position.x + leftPadding + sourceHandleIndex * step;
        }
        const sourceHandleY = sourceNode.position.y + sourceHeight;
        // Calculate target handle position
        const targetWidth = targetNode.width || 150;
        const targetHeight = targetNode.height || 40;
        let targetHandleX;
        const targetInputCount = targetNode.data.inputSources ?
          (Array.isArray(targetNode.data.inputSources) ?
            targetNode.data.inputSources.length :
            Object.keys(targetNode.data.inputSources).length) :
          0;
        if (targetInputCount === 1) {
          targetHandleX = targetNode.position.x + targetWidth / 2;
        } else {
          const leftPadding = 20;
          const rightPadding = 20;
          const availableWidth = targetWidth - leftPadding - rightPadding;
          const step = availableWidth / (targetInputCount - 1);
          targetHandleX = targetNode.position.x + leftPadding + targetHandleIndex * step;
        }
        const targetHandleY = targetNode.position.y - HANDLE_RADIUS * 2 - arrowWidth;
        // Calculate control points for bezier curve
        const verticalOffset = Math.min(200, Math.max(30, Math.abs(targetHandleY - sourceHandleY) * 0.9));
        let sourceControlY = sourceHandleY + verticalOffset;
        let targetControlY = targetHandleY - verticalOffset;
        if (sourceHandleY > targetHandleY) {
          sourceControlY = sourceHandleY - verticalOffset;
          targetControlY = targetHandleY + verticalOffset;
        }
        const sourceControlX = sourceHandleX;
        const targetControlX = targetHandleX;
        // Create path for edge - stopping ABOVE the handle circle
        const path = `M${sourceHandleX},${sourceHandleY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetHandleX},${targetHandleY}`;
        return `<path d="${path}" stroke="#555" stroke-width="1.5" fill="none" marker-end="url(#arrowhead)"/>`;
      }).join('\n    ')}
    </g>
    <g class="edge-labels">
      ${flowEdges.map(edge => {
        const sourceNode = flowNodes.find(n => n.id === edge.source);
        const targetNode = flowNodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) return '';
        const sourceHandleId = edge.sourceHandle || 'output-0';
        const targetHandleId = edge.targetHandle || 'input-0';
        const sourceHandleIndex = parseInt(sourceHandleId.split('-')[1]) || 0;
        const targetHandleIndex = parseInt(targetHandleId.split('-')[1]) || 0;
        const sourceWidth = sourceNode.width || 150;
        const sourceHeight = sourceNode.height || 40;
        let sourceHandleX;
        let sourceOutputCount = sourceNode.data.outNum || 1;
        if (sourceNode.data.isInput && Array.isArray(sourceNode.data.inputSources)) {
          sourceOutputCount = sourceNode.data.inputSources.length;
        }
        if (sourceOutputCount === 1) {
          sourceHandleX = sourceNode.position.x + sourceWidth / 2;
        } else {
          const leftPadding = 20;
          const rightPadding = 20;
          const availableWidth = sourceWidth - leftPadding - rightPadding;
          const step = availableWidth / (sourceOutputCount - 1);
          sourceHandleX = sourceNode.position.x + leftPadding + sourceHandleIndex * step;
        }
        const sourceHandleY = sourceNode.position.y + sourceHeight;
        const targetWidth = targetNode.width || 150;
        const targetHeight = targetNode.height || 40;
        let targetHandleX;
        const targetInputCount = targetNode.data.inputSources ?
          (Array.isArray(targetNode.data.inputSources) ?
            targetNode.data.inputSources.length :
            Object.keys(targetNode.data.inputSources).length) :
          0;
        if (targetInputCount === 1) {
          targetHandleX = targetNode.position.x + targetWidth / 2;
        } else {
          const leftPadding = 20;
          const rightPadding = 20;
          const availableWidth = targetWidth - leftPadding - rightPadding;
          const step = availableWidth / (targetInputCount - 1);
          targetHandleX = targetNode.position.x + leftPadding + targetHandleIndex * step;
        }
        const targetHandleY = targetNode.position.y - HANDLE_RADIUS * 2 - arrowWidth;
        const verticalOffset = Math.min(200, Math.max(30, Math.abs(targetHandleY - sourceHandleY) * 0.9));
        let sourceControlY = sourceHandleY + verticalOffset;
        let targetControlY = targetHandleY - verticalOffset;
        if (sourceHandleY > targetHandleY) {
          sourceControlY = sourceHandleY - verticalOffset;
          targetControlY = targetHandleY + verticalOffset;
        }
        const sourceControlX = sourceHandleX;
        const targetControlX = targetHandleX;
        let labelElement = '';
        if (showEdgeLabels && edge.data?.label) {
          const t = 0.92;
          const cubicBezierPoint = require('../utils/networkProcessor').cubicBezierPoint;
          const labelPoint = cubicBezierPoint(
            { x: sourceHandleX, y: sourceHandleY },
            { x: sourceControlX, y: sourceControlY },
            { x: targetControlX, y: targetControlY },
            { x: targetHandleX, y: targetHandleY },
            t
          );
          const LABEL_Y_OFFSET = 16;
          const labelX = labelPoint.x;
          const labelY = targetHandleY - LABEL_Y_OFFSET;
          const labelText = String(edge.data.label);
          const fontSize = 10;
          const charWidth = 7;
          const paddingX = 0;
          const paddingY = 4;
          const textWidth = labelText.length * charWidth;
          const rectWidth = textWidth + paddingX * 2;
          const rectHeight = fontSize + paddingY * 2;
          const rectX = labelX - rectWidth / 2;
          const rectY = labelY - rectHeight / 2;
          labelElement = `
            <g>
              <rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}" rx="6" ry="6"
                fill="white" stroke="#c9c9c9" stroke-width="0.5"/>
              <text x="${labelX}" y="${labelY + fontSize/2-4}" text-anchor="middle" dominant-baseline="middle"
                font-family="Arial, sans-serif" font-size="${fontSize}px" fill="#000" font-weight="500">${labelText}</text>
            </g>
          `;
        }
        return labelElement;
      }).join('\n    ')}
    </g>
    <g class="nodes">
      ${flowNodes.map(node => {
        const { position, data } = node;
        const width = node.width || 150;
        const height = node.height || 40;
        
        // Use the getNodeBackgroundColor function for consistent coloring
        const backgroundColor = getNodeBackgroundColor(data);
        
        // Determine border color
        let borderColor = nodeTypeStyles.default.borderColor;
        if (data.isInput) {
          borderColor = nodeTypeStyles.input.borderColor;
        } else if (data.isOutput) {
          borderColor = nodeTypeStyles.output.borderColor;
        }
        
        // Calculate input and output handles
        const inputCount = data.inputSources ? (Array.isArray(data.inputSources) ? data.inputSources.length : Object.keys(data.inputSources).length) : 0;
        const outputCount = data.outNum || 1;
        
        // Generate input handles (at top of node)
        let inputHandles = '';
        if (!data.isInput && inputCount > 0) {
          for (let i = 0; i < inputCount; i++) {
            let leftPosition;
            if (inputCount === 1) {
              leftPosition = width / 2; // Center if only one handle
            } else {
              const leftPadding = 20; // 20px from left
              const rightPadding = 20; // 20px from right
              const availableWidth = width - leftPadding - rightPadding;
              const step = availableWidth / (inputCount - 1);
              leftPosition = leftPadding + i * step;
            }
            
            // Smaller handle with white border - using the defined handle radius
            inputHandles += `<circle cx="${leftPosition}" cy="0" r="${HANDLE_RADIUS}" fill="#555" stroke="white" stroke-width="1" />`;
          }
        }
        
        // Generate output handles (at bottom of node)
        let outputHandles = '';
        // For the "input" node, use the number of outputs = number of inputSources (array length)
        let actualOutputCount = outputCount;
        if (data.isInput && Array.isArray(data.inputSources)) {
          actualOutputCount = data.inputSources.length;
        }
        if (!data.isOutput && actualOutputCount > 0) {
          for (let i = 0; i < actualOutputCount; i++) {
            let leftPosition;
            if (actualOutputCount === 1) {
              leftPosition = width / 2; // Center if only one handle
            } else {
              const leftPadding = 20; // 20px from left
              const rightPadding = 20; // 20px from right
              const availableWidth = width - leftPadding - rightPadding;
              const step = availableWidth / (actualOutputCount - 1);
              leftPosition = leftPadding + i * step;
            }
            // Smaller handle with white border - using the defined handle radius
            outputHandles += `<circle cx="${leftPosition}" cy="${height}" r="${HANDLE_RADIUS}" fill="#555" stroke="white" stroke-width="1" />`;
          }
        }
        
        // Adjust text positioning
        const middleY = height / 2;
        let labelY;
        const classY = middleY + 10;

        if (data.isInput || data.isOutput) {
          // For input/output nodes, center the label vertically
          labelY = middleY;
        } else if (!data.cls) {
          // No class: center the label vertically
          labelY = middleY;
        } else {
          // Has class: offset label and show class below
          labelY = middleY - 4;
        }

        return `<g transform="translate(${position.x},${position.y})">
        <rect width="${width}" height="${height}" rx="5" ry="5" fill="${backgroundColor}" stroke="${borderColor}" stroke-width="1"/>
        <text x="${width/2}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="12px" font-weight="bold" fill="#000">${data.label || ''}</text>
        ${(data.cls && !data.isInput && !data.isOutput) ? `<text x="${width/2}" y="${classY}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="10px" fill="#000">${data.cls}</text>` : ''}
        ${inputHandles}
        ${outputHandles}
      </g>`;
      }).join('\n    ')}
    </g>
  </svg>`;
      
      // Create a Blob and download
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      URL.revokeObjectURL(url);
      
      console.log("SVG export completed successfully");
    } catch (error) {
      console.error('Error in SVG export function:', error);
      setError(`Failed to export SVG: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [reactFlowInstance, setError, showEdgeLabels]);

  // Refactor the export functionality into a reusable function
  const exportImage = useCallback((format: 'png' | 'svg') => {
    if (reactFlowWrapper.current && reactFlowInstance && nodes.length > 0) {
      // Store current viewport
      const currentViewport = reactFlowInstance.getViewport();
      
      // Hide UI elements
      setShowUI(false);
      setShowBackground(false);
      
      // Wait for UI update to complete
      setTimeout(() => {
        try {
          console.log(`Starting ${format} export process...`);
          
          // Get the current configuration for filename
          const currentState = historyStack[currentGraphIndex];
          const currentConfig = currentState?.config;
          
          // Generate filename
          let filename = 'network-diagram';
          if (currentConfig && 'name' in currentConfig) {
            filename = currentConfig.name as string;
          } else {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            filename = `network-diagram-${timestamp}`;
          }
          
          // Add the appropriate extension
          if (format === 'svg') {
            if (!filename.endsWith('.svg')) {
              filename = filename.replace(/\.png$/, '') + '.svg';
            }
          } else {
            if (!filename.endsWith('.png')) {
              filename = filename.replace(/\.svg$/, '') + '.png';
            }
          }
          
          console.log(`Using filename: ${filename}`);
          
          if (format === 'svg') {
            // SVG-specific handling - frontend only
            // No need for fitView since we calculate our own viewBox
            handleSvgExport(filename);
            
            // Restore UI and viewport
            setTimeout(() => {
              console.log("Restoring UI and viewport after SVG export");
              setShowUI(true);
              setShowBackground(true);
              reactFlowInstance.setViewport(currentViewport);
            }, 100);
          } else {
            // For PNG, we still need to fit the view to ensure everything is visible
            reactFlowInstance.fitView({ padding: 0.1 });
            
            // Wait for the fitView animation to complete
            setTimeout(() => {
              // PNG handling - use backend cropping
              toPng(reactFlowWrapper.current!, { 
                backgroundColor: '#ffffff',
                pixelRatio: 3, // High resolution
                filter: (node) => {
                  // Filter out UI elements from the capture
                  return !node.classList?.contains('react-flow__controls') && 
                         !node.classList?.contains('react-flow__minimap') &&
                         !node.classList?.contains('react-flow__panel');
                }
              })
              .then((dataUrl: string) => {
                console.log(`PNG captured successfully, sending to backend for cropping...`);
                
                // Send to backend for cropping
                return cropImage(dataUrl, format, 30); // 30px padding
              })
              .then((croppedDataUrl: string) => {
                console.log(`Cropped PNG received from backend`);
                
                // Create download link
                const downloadLink = document.createElement('a');
                downloadLink.href = croppedDataUrl;
                downloadLink.download = filename;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                // Clean up the object URL
                URL.revokeObjectURL(croppedDataUrl);
              })
              .catch((error: Error) => {
                console.error(`Error exporting PNG:`, error);
                setError(`Failed to export PNG. Please try again.`);
              })
              .finally(() => {
                console.log("Restoring UI and viewport");
                // Restore UI elements and viewport
                setShowUI(true);
                setShowBackground(true);
                reactFlowInstance.setViewport(currentViewport);
              });
            }, 500); // Wait for fitView animation
          }
        } catch (error) {
          console.error('Error during export:', error);
          setShowUI(true);
          setShowBackground(true);
          reactFlowInstance.setViewport(currentViewport);
        }
      }, 100); // Wait for UI update
    } else {
      setError('No nodes to export. Please load a graph first.');
    }
  }, [historyStack, currentGraphIndex, reactFlowInstance, nodes, setError, handleSvgExport]);

  // Create specific handlers for PNG and SVG export
  const handleExportPNG = useCallback(() => exportImage('png'), [exportImage]);
  const handleExportSVG = useCallback(() => exportImage('svg'), [exportImage]);

  const nodeTypes: NodeTypes = React.useMemo(() => ({
    custom: (props) => <CustomNode {...props} onNodeDoubleClick={handleNodeDoubleClick} />,
  }), [handleNodeDoubleClick]);

  return (
    <EdgeLabelContext.Provider value={showEdgeLabels}>
      <div style={{ width: '100%', height: '100%' }} ref={reactFlowWrapper}> {/* Add ref here */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes} // Register custom edge types
          defaultEdgeOptions={{ type: 'modifiedBezier' }} // Always use modifiedBezier
          nodesDraggable
          elementsSelectable
          minZoom={MIN_ZOOM_LEVEL} // Add global minimum zoom constraint
          maxZoom={MAX_ZOOM_LEVEL} // Add global maximum zoom constraint
        >
          {showBackground && <Background />}
          {showUI && (
            <>
              <Controls />
              <MiniMap 
                nodeColor={(node: Node<ModuleNodeData>) => getNodeBackgroundColor(node.data)} // Use utility function for node color
                nodeStrokeWidth={3} // Optional: Add stroke width
                pannable // Enable panning on the minimap
                zoomable // Enable zooming on the minimap
                style={{ left: 'auto', right: 'auto', bottom: '120px' }}
                // Optional: Custom style for positioning
              />
            </>
          )}
          {showUI && (
            <Panel position="top-left">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".yaml,.yml" onChange={handleFileChange} />
                {/* @ts-ignore - webkitdirectory and directory are non-standard attributes */}
                <input type="file" ref={folderInputRef} style={{ display: 'none' }} webkitdirectory="" directory="" multiple onChange={handleFolderChange} />
                <button onClick={handleUploadClick} style={{ padding: '8px 12px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upload YAML File</button>
                <button onClick={handleUploadFolderClick} style={{ padding: '8px 12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upload Folder</button>
                
                {/* Preset configurations dropdown */}
                <div style={{ backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                  <label htmlFor="preset-select" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '14px' }}>
                    Pre-uploaded Configurations:
                  </label>
                  <select 
                    id="preset-select"
                    value={selectedPreset}
                    onChange={handlePresetChange}
                    style={{ 
                      width: '100%', 
                      padding: '8px', 
                      borderRadius: '4px', 
                      border: '1px solid #ced4da',
                      backgroundColor: isLoadingPresets ? '#e9ecef' : 'white',
                      cursor: isLoadingPresets ? 'wait' : 'pointer'
                    }}
                    disabled={isLoadingPresets}
                  >
                    <option value="">-- Select a configuration --</option>
                    {presets.map((preset) => (
                      <option key={preset} value={preset}>{preset}</option>
                    ))}
                  </select>
                  {isLoadingPresets && (
                    <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px' }}>Loading configurations...</div>
                  )}
                  {!isLoadingPresets && presets.length === 0 && (
                    <div style={{ fontSize: '12px', color: '#dc3545', marginTop: '5px' }}>
                      No configurations found. Check console for details.
                    </div>
                  )}
                </div>
                
                <button onClick={resetView} style={{ padding: '8px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reset View</button>
                <button onClick={handleExportPNG} style={{ padding: '8px 12px', backgroundColor: '#9c27b0', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Download PNG</button>
                <button onClick={handleExportSVG} style={{ padding: '8px 12px', backgroundColor: '#673ab7', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Download SVG</button>
                {currentGraphIndex > 0 && (
                  <button onClick={handleGoBack} style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Go Back</button>
                )}
                {/* Add checkbox for edge labels */}
                <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f0f0f0', padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc' }}>
                  <input type="checkbox" id="edge-labels-toggle" checked={showEdgeLabels} onChange={toggleEdgeLabels} style={{ marginRight: '8px' }} />
                  <label htmlFor="edge-labels-toggle" style={{ fontSize: '14px', cursor: 'pointer' }}>Show Edge Labels</label>
                </div>
                {/* Edge type toggle button removed */}
              </div>
            </Panel>
          )}
          {isGeneratingGraph && (
            <Panel position="top-center">
              <div style={{ padding: '10px', backgroundColor: 'rgba(138, 241, 134, 0.64)', borderRadius: '4px', border: '1px solid #bdbdbd', color: '#333' }}>
                Generating graph, please wait...
              </div>
            </Panel>
          )}
          {showUI && error && !isGeneratingGraph && ( // Only show error if not currently generating
            <Panel position="top-center"><div style={{ padding: '10px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', border: '1px solid #f5c6cb' }}>{error}</div></Panel>
          )}
          {showUI && file && !isGeneratingGraph && ( // Only show file if not currently generating
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
        {/* Add the global Tooltip component */}
        <Tooltip 
          id="node-tooltip" 
          place="right" 
          // effect="solid" // Removed deprecated prop
          style={{ 
            backgroundColor: 'rgba(0, 0, 0, 0.8)', 
            color: 'white',
            zIndex: 9999, // Ensure it's on top
            maxWidth: '500px', // Match previous style
            whiteSpace: 'pre-wrap', // Match previous style
            wordBreak: 'break-word', // Match previous style
            fontSize: '12px', // Match previous style
            padding: '10px', // Match previous style
            borderRadius: '5px', // Match previous style
          }} 
        />
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
