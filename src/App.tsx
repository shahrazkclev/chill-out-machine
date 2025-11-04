import { Excalidraw, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ExcalidrawImperativeAPI, ExcalidrawElement } from "@excalidraw/excalidraw/types";
import { supabase } from "@/integrations/supabase/client";
import "./App.css";

const AUTOSAVE_INTERVAL = 5000; // 5 seconds

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [sceneData, setSceneData] = useState(null);
  const [currentDrawingId, setCurrentDrawingId] = useState<string | null>(null);
  const [savedDrawings, setSavedDrawings] = useState<any[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const lastSavedRef = useRef<string>('');

  // Load all saved drawings
  const loadDrawings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('drawings')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setSavedDrawings(data || []);
    } catch (error) {
      console.error('Error loading drawings:', error);
    }
  }, []);

  // Auto-save functionality with Cloud storage
  useEffect(() => {
    if (!excalidrawAPI) return;

    const saveToCloud = async () => {
      try {
        setSaveStatus('saving');
        const elements = excalidrawAPI.getSceneElements();
        const appState = excalidrawAPI.getAppState();
        
        const sceneJSON = JSON.stringify({
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            currentItemStrokeColor: appState.currentItemStrokeColor,
            currentItemBackgroundColor: appState.currentItemBackgroundColor,
            currentItemFillStyle: appState.currentItemFillStyle,
            currentItemStrokeWidth: appState.currentItemStrokeWidth,
            currentItemRoughness: appState.currentItemRoughness,
          }
        });

        // Only save if content changed
        if (sceneJSON === lastSavedRef.current) {
          setSaveStatus('saved');
          return;
        }

        lastSavedRef.current = sceneJSON;

        if (currentDrawingId) {
          // Update existing drawing
          const { error } = await supabase
            .from('drawings')
            .update({ scene_data: JSON.parse(sceneJSON) })
            .eq('id', currentDrawingId);

          if (error) throw error;
        } else if (elements.length > 0) {
          // Create new drawing only if there are elements
          const { data, error } = await supabase
            .from('drawings')
            .insert({ scene_data: JSON.parse(sceneJSON) })
            .select()
            .single();

          if (error) throw error;
          setCurrentDrawingId(data.id);
        }

        setSaveStatus('saved');
      } catch (error) {
        console.error('Error saving scene:', error);
        setSaveStatus('error');
      }
    };

    const interval = setInterval(saveToCloud, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [excalidrawAPI, currentDrawingId]);

  // Load scene on mount
  useEffect(() => {
    loadDrawings();

    // Try to load from URL param first
    const urlParams = new URLSearchParams(window.location.search);
    const drawingId = urlParams.get('id');

    if (drawingId) {
      loadDrawing(drawingId);
    } else {
      // Load from local storage as fallback
      try {
        const savedScene = localStorage.getItem('excalidraw-scene');
        if (savedScene) {
          setSceneData(JSON.parse(savedScene));
        }
      } catch (error) {
        console.error('Error loading scene:', error);
      }
    }
  }, []);

  // Load a specific drawing
  const loadDrawing = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('drawings')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      setSceneData(data.scene_data);
      setCurrentDrawingId(id);
      
      // Update URL without reload
      window.history.pushState({}, '', `?id=${id}`);
    } catch (error) {
      console.error('Error loading drawing:', error);
    }
  };

  // Create new drawing
  const handleNew = useCallback(() => {
    if (excalidrawAPI) {
      excalidrawAPI.resetScene();
      setCurrentDrawingId(null);
      window.history.pushState({}, '', '/');
      lastSavedRef.current = '';
    }
  }, [excalidrawAPI]);

  // Delete a drawing
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this drawing?')) return;

    try {
      const { error } = await supabase
        .from('drawings')
        .delete()
        .eq('id', id);

      if (error) throw error;

      if (currentDrawingId === id) {
        handleNew();
      }

      await loadDrawings();
    } catch (error) {
      console.error('Error deleting drawing:', error);
    }
  };

  // Export functionality - PNG
  const handleExportPNG = useCallback(async () => {
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
      link.download = `drawing-${Date.now()}.png`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting PNG:', error);
    }
  }, [excalidrawAPI]);

  // Export functionality - SVG
  const handleExportSVG = useCallback(async () => {
    if (!excalidrawAPI) return;

    try {
      const svg = await exportToSvg({
        elements: excalidrawAPI.getSceneElements() as ExcalidrawElement[],
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });

      const svgString = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `drawing-${Date.now()}.svg`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting SVG:', error);
    }
  }, [excalidrawAPI]);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Saved Drawings</h2>
          <button onClick={() => setShowSidebar(false)} className="close-btn">✕</button>
        </div>
        <div className="sidebar-content">
          {savedDrawings.map((drawing) => (
            <div key={drawing.id} className="drawing-item">
              <div onClick={() => {
                loadDrawing(drawing.id);
                setShowSidebar(false);
              }}>
                <h3>{drawing.name}</h3>
                <p>{new Date(drawing.updated_at).toLocaleDateString()}</p>
              </div>
              <button onClick={() => handleDelete(drawing.id)} className="delete-btn">
                Delete
              </button>
            </div>
          ))}
          {savedDrawings.length === 0 && (
            <p className="empty-state">No saved drawings yet</p>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <button onClick={() => setShowSidebar(true)} className="menu-btn">
            ☰ Drawings
          </button>
          <button onClick={handleNew} className="new-btn">
            + New
          </button>
          <span className="save-status">
            {saveStatus === 'saving' && '💾 Saving...'}
            {saveStatus === 'saved' && '✓ Saved'}
            {saveStatus === 'error' && '⚠️ Error'}
          </span>
        </div>
        <h1>Excalidraw Drawing Tool</h1>
        <div className="toolbar-right">
          <button onClick={handleExportPNG} className="export-btn">
            Export PNG
          </button>
          <button onClick={handleExportSVG} className="export-btn">
            Export SVG
          </button>
        </div>
      </div>

      {/* Main Drawing Area */}
      <div className="excalidraw-wrapper">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={sceneData}
          theme="light"
          name="Excalidraw Drawing"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: { saveFileToDisk: false },
              loadScene: false,
              saveToActiveFile: false,
              theme: true,
            },
          }}
        />
      </div>
    </div>
  );
}

export default App;

export default App;
