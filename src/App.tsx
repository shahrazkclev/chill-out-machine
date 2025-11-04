import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import { useState, useEffect, useCallback } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { supabase } from "@/integrations/supabase/client";
import "./App.css";

const AUTOSAVE_INTERVAL = 10000; // 10 seconds

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [sceneData, setSceneData] = useState(null);

  // Auto-save functionality
  useEffect(() => {
    if (!excalidrawAPI) return;

    const saveToCloud = async () => {
      try {
        const elements = excalidrawAPI.getSceneElements();
        const appState = excalidrawAPI.getAppState();
        
        // Save to local storage
        localStorage.setItem('excalidraw-scene', JSON.stringify({
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            currentItemStrokeColor: appState.currentItemStrokeColor,
            currentItemBackgroundColor: appState.currentItemBackgroundColor,
          }
        }));

        console.log('Scene saved to local storage');
      } catch (error) {
        console.error('Error saving scene:', error);
      }
    };

    const interval = setInterval(saveToCloud, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [excalidrawAPI]);

  // Load scene on mount
  useEffect(() => {
    try {
      const savedScene = localStorage.getItem('excalidraw-scene');
      if (savedScene) {
        setSceneData(JSON.parse(savedScene));
      }
    } catch (error) {
      console.error('Error loading scene:', error);
    }
  }, []);

  // Export functionality
  const handleExport = useCallback(async () => {
    if (!excalidrawAPI) return;

    try {
      const blob = await exportToBlob({
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `excalidraw-${Date.now()}.png`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting:', error);
    }
  }, [excalidrawAPI]);

  return (
    <div className="app-container">
      <div className="toolbar">
        <h1>Drawing Tool</h1>
        <button onClick={handleExport} className="export-btn">
          Export PNG
        </button>
      </div>
      <div className="excalidraw-wrapper">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={sceneData}
          theme="light"
        />
      </div>
    </div>
  );
}

export default App;
