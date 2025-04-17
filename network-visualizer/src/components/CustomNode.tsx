import React, { memo, useState, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ModuleNodeData } from '../types';
import yaml from 'js-yaml';

// Styles for the custom node
const nodeStyles: React.CSSProperties = {
  padding: '10px',
  borderRadius: '5px',
  width: '180px',
  fontSize: '12px',
  color: '#222',
  textAlign: 'center',
  borderWidth: '1px',
  borderStyle: 'solid',
  opacity: 1
};

// Different styles for different node types
const nodeTypeStyles = {
  entry: {
    backgroundColor: '#a2c3fa',
    borderColor: '#949494'
  },
  exit: {
    backgroundColor: '#d0c6f5',
    borderColor: '#949494'
  },
  default: {
    backgroundColor: '#f2c496',
    borderColor: '#949494'
  }
};

// Handle styles
const handleStyle = {
  width: '10px',
  height: '10px',
  borderRadius: '50%'
};

// Tooltip styles
const tooltipStyles: React.CSSProperties = {
  position: 'absolute',
  top: '-10px',
  left: '100%',
  transform: 'translateY(-100%)',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  color: 'white',
  padding: '10px',
  borderRadius: '5px',
  fontSize: '12px',
  zIndex: 1000,
  minWidth: '200px',
  maxWidth: '300px',
  textAlign: 'left',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
  pointerEvents: 'none',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word'
};

interface CustomNodeProps extends NodeProps<ModuleNodeData> {}

const CustomNode: React.FC<CustomNodeProps> = ({ data, isConnectable, id }) => {
  const { label, cls, isEntry, isExit, outNum = 1, config } = data;
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Determine node type for styling
  const nodeType = isEntry ? 'entry' : isExit ? 'exit' : 'default';
  
  // Calculate the number of input and output handles
  let inputCount = 0;
  let outputCount = 0;
  
  if (isEntry) {
    // Entry node has no inputs, but has outputs based on inputSources
    const entrySources = data.inputSources as string[] || [];
    inputCount = 0;
    outputCount = entrySources.length;
  } else if (isExit) {
    // Exit node has inputs based on inputSources, but no outputs
    if (Array.isArray(data.inputSources)) {
      // Exit node has inputs as a list
      const exitInputs = data.inputSources as string[] || [];
      inputCount = exitInputs.length;
    } else {
      // Exit node has inputs as a dictionary
      const exitInputs = data.inputSources as Record<string, string> || {};
      inputCount = Object.keys(exitInputs).length;
    }
    outputCount = 0;
  } else {
    // Regular nodes have inputs based on inputSources and outputs based on outNum
    const inputs = data.inputSources as string[] || [];
    inputCount = inputs.length;
    outputCount = outNum || 1;
  }
  
  // Calculate the maximum number of handles
  const maxHandles = Math.max(inputCount, outputCount);
  
  // Calculate the node height based on the maximum number of handles
  const nodeHeight = 30 + maxHandles * 20;
  
  // Create the style with dynamic height
  const style = { 
    ...nodeStyles, 
    ...nodeTypeStyles[nodeType],
    height: `${nodeHeight}px`
  };
  
  // Generate input handles
  const renderInputHandles = () => {
    if (isEntry) {
      // Entry node doesn't have input handles
      return null;
    }
    
    if (isExit) {
      // Exit node can have inputs as either a list or a dictionary
      let outputNames: string[] = [];
      let totalHandles = 0;
      
      let isList = false;
      if (Array.isArray(data.inputSources)) {
        // Exit node has inputs as a list
        const exitInputs = data.inputSources as string[];
        totalHandles = exitInputs.length;
        outputNames = exitInputs.map((_, index) => index.toString());
        isList = true;
      } else {
        // Exit node has inputs as a dictionary
        const exitInputs = data.inputSources as Record<string, string>;
        outputNames = Object.keys(exitInputs);
        totalHandles = outputNames.length;
      }
      
      // Calculate handle positions for exit node
      
      return (
        <>
          {outputNames.map((outputName, index) => {
            // Calculate position in pixels
            let topPosition;
            if (totalHandles === 1) {
              // If only one handle, center it
              topPosition = nodeHeight / 2;
            } else {
              // For multiple handles
              const topPadding = 20; // 20px from top
              const bottomPadding = 20; // 20px from bottom
              const availableHeight = nodeHeight - topPadding - bottomPadding;
              
              if (index === 0) {
                // First handle
                topPosition = topPadding;
              } else if (index === totalHandles - 1) {
                // Last handle
                topPosition = nodeHeight - bottomPadding;
              } else {
                // Handles in between
                const step = availableHeight / (totalHandles - 1);
                topPosition = topPadding + (index * step);
              }
            }
            
            // Convert to percentage for CSS
            const topPercentage = (topPosition / nodeHeight) * 100;
            
            return (
              <React.Fragment key={`input-fragment-${outputName}`}>
                <Handle
                  key={`input-${outputName}`}
                  type="target"
                  position={Position.Left}
                  id={`input-${outputName}`}
                  style={{
                    ...handleStyle,
                    top: `${topPercentage}%`
                  }}
                  isConnectable={isConnectable}
                />
                {!isList && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '20px',
                      top: `${topPercentage - 6}%`, // Slightly above the handle
                      fontSize: '10px',
                      textAlign: 'left'
                    }}
                  >
                    {outputName}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </>
      );
    }
    
    // Regular nodes have numbered input handles based on their input sources
    const inputs = data.inputSources as string[] || [];
    const inputCount = inputs.length;
    
    return Array.from({ length: inputCount }).map((_, index) => {
      // Calculate position in pixels
      let topPosition;
      if (inputCount === 1) {
        // If only one handle, center it
        topPosition = nodeHeight / 2;
      } else {
        // For multiple handles
        const topPadding = 20; // 20px from top
        const bottomPadding = 20; // 20px from bottom
        const availableHeight = nodeHeight - topPadding - bottomPadding;
        
        if (index === 0) {
          // First handle
          topPosition = topPadding;
        } else if (index === inputCount - 1) {
          // Last handle
          topPosition = nodeHeight - bottomPadding;
        } else {
          // Handles in between
          const step = availableHeight / (inputCount - 1);
          topPosition = topPadding + (index * step);
        }
      }
      
      // Convert to percentage for CSS
      const topPercentage = (topPosition / nodeHeight) * 100;
      
      return (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Left}
          id={`input-${index}`}
          style={{
            ...handleStyle,
            top: `${topPercentage}%`
          }}
          isConnectable={isConnectable}
        />
      );
    });
  };
  
  // Generate output handles
  const renderOutputHandles = () => {
    if (isExit) {
      // Exit node doesn't have output handles
      return null;
    }
    
    if (isEntry) {
      // Entry node has output handles based on its input sources
      const entrySources = data.inputSources as string[] || [];
      const outputCount = entrySources.length;
      
      return Array.from({ length: outputCount }).map((_, index) => {
        // Calculate position in pixels
        let topPosition;
        if (outputCount === 1) {
          // If only one handle, center it
          topPosition = nodeHeight / 2;
        } else {
          // For multiple handles
          const topPadding = 20; // 20px from top
          const bottomPadding = 20; // 20px from bottom
          const availableHeight = nodeHeight - topPadding - bottomPadding;
          
          if (index === 0) {
            // First handle
            topPosition = topPadding;
          } else if (index === outputCount - 1) {
            // Last handle
            topPosition = nodeHeight - bottomPadding;
          } else {
            // Handles in between
            const step = availableHeight / (outputCount - 1);
            topPosition = topPadding + (index * step);
          }
        }
        
        // Convert to percentage for CSS
        const topPercentage = (topPosition / nodeHeight) * 100;
        
        return (
          <Handle
            key={`output-${index}`}
            type="source"
            position={Position.Right}
            id={`output-${index}`}
            style={{
              ...handleStyle,
              top: `${topPercentage}%`
            }}
            isConnectable={isConnectable}
          />
        );
      });
    }
    
    // Number of outputs for regular nodes
    const outputCount = outNum || 1;
    
    return Array.from({ length: outputCount }).map((_, index) => {
      // Calculate position in pixels
      let topPosition;
      if (outputCount === 1) {
        // If only one handle, center it
        topPosition = nodeHeight / 2;
      } else {
        // For multiple handles
        const topPadding = 20; // 20px from top
        const bottomPadding = 20; // 20px from bottom
        const availableHeight = nodeHeight - topPadding - bottomPadding;
        
        if (index === 0) {
          // First handle
          topPosition = topPadding;
        } else if (index === outputCount - 1) {
          // Last handle
          topPosition = nodeHeight - bottomPadding;
        } else {
          // Handles in between
          const step = availableHeight / (outputCount - 1);
          topPosition = topPadding + (index * step);
        }
      }
      
      // Convert to percentage for CSS
      const topPercentage = (topPosition / nodeHeight) * 100;
      
      return (
        <Handle
          key={`output-${index}`}
          type="source"
          position={Position.Right}
          id={`output-${index}`}
          style={{
            ...handleStyle,
            top: `${topPercentage}%`
          }}
          isConnectable={isConnectable}
        />
      );
    });
  };
  
  // Format config for display in YAML format
  const formatConfig = (config: Record<string, any> | string | undefined): string => {
    if (!config) return '';
    
    // If config is a string (file path), return it directly
    if (typeof config === 'string') {
      return `Config file: ${config}`;
    }
    
    // Convert the config object to YAML format
    try {
      return yaml.dump(config, {
        indent: 2,
        lineWidth: -1, // No line wrapping
        noRefs: true,  // Don't output YAML references
        sortKeys: true // Sort object keys
      });
    } catch (error) {
      console.error('Error converting config to YAML:', error);
      
      // Fallback to simple key-value format if YAML conversion fails
      return Object.entries(config)
        .map(([key, value]) => {
          // Format the value based on its type
          let formattedValue = value;
          if (typeof value === 'object' && value !== null) {
            try {
              formattedValue = yaml.dump(value, { indent: 2 });
            } catch (e) {
              formattedValue = JSON.stringify(value, null, 2);
            }
          }
          
          return `${key}: ${formattedValue}`;
        })
        .join('\n');
    }
  };
  
  return (
    <div 
      style={style}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      data-testid={`node-${id}`}
    >
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        position: 'relative',
        zIndex: 1
      }}>
        <div style={{ fontWeight: 'bold' }}>{label}</div>
        {cls && <div style={{ fontSize: '10px' }}>{cls}</div>}
        
        {/* Config tooltip */}
        {showTooltip && config && (
          <div style={tooltipStyles}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Configuration:</div>
            <pre style={{ margin: 0 }}>{formatConfig(config)}</pre>
          </div>
        )}
      </div>
      
      {renderInputHandles()}
      {renderOutputHandles()}
    </div>
  );
};

export default memo(CustomNode);
