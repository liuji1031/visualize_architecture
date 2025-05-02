import React, { memo, useState, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ModuleNodeData } from '../types';
import yaml from 'js-yaml';

// Styles for the custom node (Simplified)
const nodeStyles: React.CSSProperties = {
  padding: '10px 15px', // Adjusted padding
  borderRadius: '8px', // Slightly more rounded corners
  // width: '180px', // Let width be more dynamic based on content? Or keep fixed? Let's try dynamic first.
  minWidth: '150px', // Ensure a minimum width
  fontSize: '12px',
  color: '#222',
  textAlign: 'center',
  borderWidth: '1px',
  borderStyle: 'solid',
  // Removed opacity, assuming it's not needed
  // Removed the double-box effect by ensuring no extra borders or shadows are implicitly added
  // Background color will be set based on type/cls
  position: 'relative', // Needed for absolute positioning of handles
};

// Function to generate a consistent hash from a string
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

// Function to generate a color based on a class name
const generateColorFromCls = (cls: string): string => {
  const hash = hashString(cls);
  
  // Use HSL color model for better control over saturation and lightness
  // Hue: 0-360 (full color spectrum)
  // Saturation: 25-45% (not too saturated)
  // Lightness: 75-85% (light enough for text readability)
  const hue = hash % 360;
  const saturation = 50 + (hash % 20); // 50-70%
  const lightness = 75 + (hash % 10); // 75-85%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Different styles for different node types
const nodeTypeStyles = {
  entry: {
    backgroundColor: '#a2c3fa',
    borderColor: '#949494'
  },
  exit: {
    backgroundColor: '#ffc891',
    borderColor: '#949494'
  },
  default: {
    backgroundColor: '#f2c496',
    borderColor: '#949494'
  }
};

// Handle styles (Adjusted for top/bottom)
const handleStyle = {
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  background: '#555', // Make handles more visible
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

interface CustomNodeProps extends NodeProps<ModuleNodeData> {
  onNodeDoubleClick?: (nodeId: string, configPath: string, moduleName?: string) => void; // Updated to include moduleName
}

const CustomNode: React.FC<CustomNodeProps> = ({ data, isConnectable, id, ...props }) => { // Destructure props to get onNodeDoubleClick
  const { label, cls, isEntry, isExit, outNum = 1, config } = data;
  const [showTooltip, setShowTooltip] = useState(false);
  const { onNodeDoubleClick } = props; // Get the callback from props

  // Determine node type for styling
  const nodeType = isEntry ? 'entry' : isExit ? 'exit' : 'default';
  
  // Generate style based on cls for non-entry/exit nodes
  let nodeStyle = nodeTypeStyles[nodeType];
  if (!isEntry && !isExit && cls) {
    if (cls === 'ComposableModel') {
      // Use specific color for ComposableModel nodes
      nodeStyle = {
        ...nodeTypeStyles.default,
        backgroundColor: '#b8a6ed'
      };
    } else {
      // For other nodes, use the color generated from cls
      nodeStyle = {
        ...nodeTypeStyles.default,
        backgroundColor: generateColorFromCls(cls)
      };
    }
  }
  
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
  
  // Calculate the node width based on the maximum number of handles
  const nodeWidth = 100 + maxHandles * 25; // Adjust width based on handles

  // Create the style with dynamic width
  const style = {
    ...nodeStyles,
    ...nodeStyle,
    width: `${nodeWidth}px`,
    // Height can be auto or fixed, let's try auto first
    height: 'auto', // Let height adjust to content + padding
    minHeight: '40px', // Ensure a minimum height
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
      
      // Calculate handle positions for exit node (only horizontal needed now)
      
      return (
        <>
          {outputNames.map((outputName, index) => {
            // Calculate horizontal position for handles
            let leftPosition;
            if (totalHandles === 1) {
              leftPosition = nodeWidth / 2; // Center if only one handle
            } else {
              const leftPadding = 20; // 20px from left
              const rightPadding = 20; // 20px from right
              const availableWidth = nodeWidth - leftPadding - rightPadding;
              const step = availableWidth / (totalHandles - 1);
              leftPosition = leftPadding + index * step;
            }

            // Convert to percentage for CSS
            const leftPercentage = (leftPosition / nodeWidth) * 100;

            return (
              <React.Fragment key={`input-fragment-${outputName}`}>
                <Handle
                  key={`input-${outputName}`}
                  type="target"
                  position={Position.Top} // Changed to Top
                  id={`input-${outputName}`}
                  style={{
                    ...handleStyle,
                    left: `${leftPercentage}%`, // Use left for horizontal positioning
                  }}
                  isConnectable={isConnectable}
                />
                {!isList && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${leftPercentage}%`, // Align with handle
                      top: '-15px', // Position above the handle
                      transform: 'translateX(-50%)', // Center the text
                      fontSize: '10px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
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
      // Calculate horizontal position for handles
      let leftPosition;
      if (inputCount === 1) {
        leftPosition = nodeWidth / 2; // Center if only one handle
      } else {
        const leftPadding = 20; // 20px from left
        const rightPadding = 20; // 20px from right
        const availableWidth = nodeWidth - leftPadding - rightPadding;
        const step = availableWidth / (inputCount - 1);
        leftPosition = leftPadding + index * step;
      }

      // Convert to percentage for CSS
      const leftPercentage = (leftPosition / nodeWidth) * 100;

      return (
        <Handle
          key={`input-${index}`}
          type="target"
          position={Position.Top} // Changed to Top
          id={`input-${index}`}
          style={{
            ...handleStyle,
            left: `${leftPercentage}%`, // Use left for horizontal positioning
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
        // Calculate horizontal position for handles
        let leftPosition;
        if (outputCount === 1) {
          leftPosition = nodeWidth / 2; // Center if only one handle
        } else {
          const leftPadding = 20; // 20px from left
          const rightPadding = 20; // 20px from right
          const availableWidth = nodeWidth - leftPadding - rightPadding;
          const step = availableWidth / (outputCount - 1);
          leftPosition = leftPadding + index * step;
        }

        // Convert to percentage for CSS
        const leftPercentage = (leftPosition / nodeWidth) * 100;

        return (
          <Handle
            key={`output-${index}`}
            type="source"
            position={Position.Bottom} // Changed to Bottom
            id={`output-${index}`}
            style={{
              ...handleStyle,
              left: `${leftPercentage}%`, // Use left for horizontal positioning
            }}
            isConnectable={isConnectable}
          />
        );
      });
    }

    // Number of outputs for regular nodes
    const outputCount = outNum || 1;

    return Array.from({ length: outputCount }).map((_, index) => {
      // Calculate horizontal position for handles
      let leftPosition;
      if (outputCount === 1) {
        leftPosition = nodeWidth / 2; // Center if only one handle
      } else {
        const leftPadding = 20; // 20px from left
        const rightPadding = 20; // 20px from right
        const availableWidth = nodeWidth - leftPadding - rightPadding;
        const step = availableWidth / (outputCount - 1);
        leftPosition = leftPadding + index * step;
      }

      // Convert to percentage for CSS
      const leftPercentage = (leftPosition / nodeWidth) * 100;

      return (
        <Handle
          key={`output-${index}`}
          type="source"
          position={Position.Bottom} // Changed to Bottom
          id={`output-${index}`}
          style={{
            ...handleStyle,
            left: `${leftPercentage}%`, // Use left for horizontal positioning
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

  // Handle double click for ComposableModel nodes with config paths
  const handleDoubleClick = useCallback(() => {
    if (onNodeDoubleClick && cls === 'ComposableModel' && typeof config === 'string') {
      onNodeDoubleClick(id, config, label);
    }
  }, [id, cls, config, onNodeDoubleClick, label]);
  
  return (
    <div 
      style={style}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onDoubleClick={handleDoubleClick} // Add double click handler
      data-testid={`node-${id}`}
    >
      {/* Simplified inner div */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%', // Take full height of the parent div
        // No extra positioning needed here now
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
