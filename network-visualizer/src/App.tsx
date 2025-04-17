import React from 'react';
import './App.css';
import NetworkVisualizer from './components/NetworkVisualizer';

function App() {
  return (
    <div className="App">
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100vh', 
        width: '100vw' 
      }}>
        <header style={{ 
          padding: '1rem', 
          backgroundColor: '#f8f9fa', 
          borderBottom: '1px solid #dee2e6' 
        }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Neural Network Architecture Visualizer</h1>
        </header>
        
        <main style={{ flex: 1, position: 'relative' }}>
          <NetworkVisualizer />
        </main>
      </div>
    </div>
  );
}

export default App;
