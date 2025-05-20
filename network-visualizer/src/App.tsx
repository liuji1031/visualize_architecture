import React, { useState, useCallback } from 'react'; // Added useState, useCallback
import './App.css';
import NetworkVisualizer from './components/NetworkVisualizer';

function App() {
  const [currentModelPath, setCurrentModelPath] = useState<string>('');

  const handleModelPathChange = useCallback((newPath: string) => {
    setCurrentModelPath(newPath);
  }, []);

  return (
    <div className="App">
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh', 
        width: '100vw' 
      }}>
        <header className="app-header">
          <h1 style={{ margin: 0, fontSize: '1.5rem', marginRight: 'auto' }}>Neural Network Architecture Visualizer</h1>
          {currentModelPath && (
            <div className="model-path-display">
              model: {currentModelPath}
            </div>
          )}
          <div className="header-links">
            <a
              href="https://liuji1031.github.io/model_composer_mkdocs/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation
            </a>
            <a
              href="https://github.com/liuji1031/model_composer"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </header>
        
        <main style={{ flex: 1, position: 'relative' }}>
          <NetworkVisualizer
            currentModelPath={currentModelPath}
            onModelPathChange={handleModelPathChange}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
