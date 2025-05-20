import React, { useContext } from 'react';
import { EdgeProps, getBezierPath, Position, EdgeLabelRenderer } from 'reactflow';
import { EdgeLabelContext } from './NetworkVisualizer'; // Import the context
import { cubicBezierPoint } from '../utils/networkProcessor';

// Function to calculate modified Bezier path for vertical layout
const getModifiedBezierPath = (
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
  targetPosition: Position
): string => {
  // Calculate the vertical distance for control points
  // A larger value makes the curve start/end more vertically (perpendicular)
  const verticalOffset = Math.min(200, Math.max(30, Math.abs(targetY - sourceY) * 0.9)); // Clipped between 10 and 30

  let sourceControlY = sourceY + verticalOffset;
  let targetControlY = targetY - verticalOffset;

  // If source is below target, swap the control point adjustments
  if (sourceY > targetY) {
    sourceControlY = sourceY - verticalOffset;
    targetControlY = targetY + verticalOffset;
  }

  // Use the source and target X directly for control points to keep vertical alignment
  const sourceControlX = sourceX;
  const targetControlX = targetX;


  // Construct the SVG path string for a cubic Bezier curve
  // M = Move to start point
  // C = Cubic Bezier curve to target point, using two control points
  const path = `M${sourceX},${sourceY} C ${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`;

  return path;
};


const ModifiedBezierEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom, // Default for vertical layout
  targetPosition = Position.Top,   // Default for vertical layout
  style = {},
  markerEnd,
  data, // Add data to access the label
}) => {
  // Consume the context value to determine if labels should be shown
  const showLabels = useContext(EdgeLabelContext);
  // Calculate the modified path
  const edgePath = getModifiedBezierPath(
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  );

  // Calculate the label position along the curve near the target handle, with a y-offset
  const verticalOffset = Math.min(200, Math.max(30, Math.abs(targetY - sourceY) * 0.9));
  let sourceControlY = sourceY + verticalOffset;
  let targetControlY = targetY - verticalOffset;
  if (sourceY > targetY) {
    sourceControlY = sourceY - verticalOffset;
    targetControlY = targetY + verticalOffset;
  }
  const sourceControlX = sourceX;
  const targetControlX = targetX;

  // Use t near 1 to get a point close to the target handle
  const t = 0.92;
  const labelPoint = cubicBezierPoint(
    { x: sourceX, y: sourceY },
    { x: sourceControlX, y: sourceControlY },
    { x: targetControlX, y: targetControlY },
    { x: targetX, y: targetY },
    t
  );
  const LABEL_Y_OFFSET = 22;
  const labelX = labelPoint.x;
  const labelY = targetY - LABEL_Y_OFFSET;

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
        style={{
          ...style,
          strokeWidth: 1.5,  // Explicit stroke width
          stroke: '#555',    // Explicit stroke color
          fill: 'none'       // Prevent fill
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      
      {/* Conditionally render label based on context */}
      {showLabels && data?.label && (
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

export default ModifiedBezierEdge;
