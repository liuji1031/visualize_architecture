import React, { memo, useState, useCallback } from 'react';
import { Handle, Position, NodeProps, Node } from 'reactflow'; // Import Node type
import { ModuleNodeData } from '../types';
import yaml from 'js-yaml';
import { getNodeBackgroundColor, nodeTypeStyles } from '../utils/colorUtils'; // Import color utils

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
  zIndex: 9999, // High z-index to ensure it's above everything
  minWidth: '250px',
  maxWidth: '500px',
  width: 'auto',
  maxHeight: '80vh',
  overflow: 'auto',
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
  const { label, cls, isInput, isOutput, outNum = 1, config } = data;
  // const [showTooltip, setShowTooltip] = useState(false); // Removed state
  const [isAnimating, setIsAnimating] = useState(false);
  const { onNodeDoubleClick } = props; // Get the callback from props

  // Get background color using the utility function
  const backgroundColor = getNodeBackgroundColor(data);
  let borderColor = nodeTypeStyles.default.borderColor; // Default border color

  if (data.isInput) {
    borderColor = nodeTypeStyles.input.borderColor;
  } else if (data.isOutput) {
    borderColor = nodeTypeStyles.output.borderColor;
  }
  
  // Calculate the number of input and output handles
  let inputCount = 0;
  let outputCount = 0;
  
  if (isInput) {
    // Input node has no inputs, but has outputs based on inputSources
    const inputSources = data.inputSources as string[] || [];
    inputCount = 0;
    outputCount = inputSources.length;
  } else if (isOutput) {
    // Output node has inputs based on inputSources, but no outputs
    if (Array.isArray(data.inputSources)) {
      // Output node has inputs as a list
      const outputInputs = data.inputSources as string[] || [];
      inputCount = outputInputs.length;
    } else {
      // Output node has inputs as a dictionary
      const outputInputs = data.inputSources as Record<string, string> || {};
      inputCount = Object.keys(outputInputs).length;
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

  // Create the style with dynamic width and calculated background color
  const style = {
    ...nodeStyles,
    backgroundColor: backgroundColor,
    borderColor: borderColor,
    width: `${nodeWidth}px`,
    // Height can be auto or fixed, let's try auto first
    height: 'auto', // Let height adjust to content + padding
    minHeight: '40px', // Ensure a minimum height
  };
  
  // Generate input handles
  const renderInputHandles = () => {
    if (isInput) {
      // Input node doesn't have input handles
      return null;
    }
    
    if (isOutput) {
      // Output node can have inputs as either a list or a dictionary
      let outputNames: string[] = [];
      let totalHandles = 0;
      
      let isList = false;
      if (Array.isArray(data.inputSources)) {
        // Output node has inputs as a list
        const outputInputs = data.inputSources as string[];
        totalHandles = outputInputs.length;
        outputNames = outputInputs.map((_, index) => index.toString());
        isList = true;
      } else {
        // Output node has inputs as a dictionary
        const outputInputs = data.inputSources as Record<string, string>;
        outputNames = Object.keys(outputInputs);
        totalHandles = outputNames.length;
      }
      
      // Calculate handle positions for output node (only horizontal needed now)
      
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
    if (isOutput) {
      // Output node doesn't have output handles
      return null;
    }
    
    if (isInput) {
      // Input node has output handles based on its input sources
      const inputSources = data.inputSources as string[] || [];
      const outputCount = inputSources.length;
      
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
    if (cls === 'ComposableModel') {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 400);
    }
    if (onNodeDoubleClick && cls === 'ComposableModel' && typeof config === 'string') {
      onNodeDoubleClick(id, config, label);
    }
  }, [id, cls, config, onNodeDoubleClick, label]);
  
  // Format config for display in YAML format
  const formattedConfig = formatConfig(config);

  return (
    <div 
      style={style}
      className={isAnimating && cls === 'ComposableModel' ? 'composable-animate' : undefined}
      onDoubleClick={handleDoubleClick} // Add double click handler
      data-testid={`node-${id}`}
      data-tooltip-id="node-tooltip" // Added for react-tooltip
      data-tooltip-content={formattedConfig} // Added for react-tooltip
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
        
        {/* Removed inline tooltip div */}
      </div>
      
      {renderInputHandles()}
      {renderOutputHandles()}
    </div>
  );
};

export default memo(CustomNode);
