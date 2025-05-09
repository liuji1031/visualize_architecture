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

// Function to generate a color based on a class name or label
export const generateColorFromString = (str: string): string => {
  if (!str) {
    // Default color if string is empty or undefined
    return '#f2c496'; // Default node color
  }
  const hash = hashString(str);
  
  // Use HSL color model for better control over saturation and lightness
  // Hue: 0-360 (full color spectrum)
  // Saturation: 50-70% (not too saturated)
  // Lightness: 75-85% (light enough for text readability)
  const hue = hash % 360;
  const saturation = 50 + (hash % 20); // 50-70%
  const lightness = 75 + (hash % 10); // 75-85%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Define base node type styles (can be used in both CustomNode and MiniMap)
export const nodeTypeStyles = {
  input: {
    backgroundColor: '#ffffff', // White
    borderColor: '#000000'  // Black
  },
  output: {
    backgroundColor: '#ffffff', // White
    borderColor: '#000000'  // Black
  },
  default: {
    backgroundColor: '#f2c496', // Default color used if no cls/label
    borderColor: '#949494'
  }
};

// Function to get the background color for a node based on its data
export const getNodeBackgroundColor = (nodeData: any): string => {
  const { label, cls, isInput, isOutput } = nodeData || {};

  if (isInput) return nodeTypeStyles.input.backgroundColor;
  if (isOutput) return nodeTypeStyles.output.backgroundColor;

  // If cls field doesn't exist, use the module name (label) for color generation
  if (cls === undefined) {
    return label ? generateColorFromString(label) : nodeTypeStyles.default.backgroundColor;
  }

  // Check for 'conv' related classes
  if (typeof cls === 'string' && cls.toLowerCase().includes('conv')) {
    return '#b3d0ff'; // Specified bluish color
  }
  
  if (cls === 'ComposableModel' && label) {
    return generateColorFromString(label); // Use label for ComposableModel
  } else {
    return generateColorFromString(cls); // Use cls for other types (that don't contain 'conv')
  }
};
