import React, { memo } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from 'reactflow';
import { ModuleEdgeData } from '../types';

const CustomEdge: React.FC<EdgeProps<ModuleEdgeData>> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd,
}) => {
  // Calculate the path for the edge
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Edge styles
  const edgeStyle: React.CSSProperties = {
    stroke: '#555',
    strokeWidth: 1.5,
    ...style,
  };

  // Label styles
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 1.0)',
    padding: '2px 4px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 500,
    pointerEvents: 'all',
    border: '1px solid #ccc',
  };

  return (
    <>
      <path
        id={id}
        style={edgeStyle}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              ...labelStyle,
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            className="nodrag nopan"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default memo(CustomEdge);
