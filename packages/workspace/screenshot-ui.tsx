import React, { useState } from "react";
import type { ScreenshotMetadata, ScreenshotDecisionUI } from "../core/screenshot-manager.js";

interface ScreenshotUIProps {
  screenshots: ScreenshotMetadata[];
  screenshotData: Map<string, Buffer>;
  onKeep: (ids: string[]) => void;
  onCancel?: () => void;
}

interface ScreenshotDecisionState {
  selected: Set<string>;
  currentIndex: number;
  preview: Buffer | null;
}

export function ScreenshotDecisionUI({
  screenshots,
  screenshotData,
  onKeep,
  onCancel
}: ScreenshotUIProps) {
  const [state, setState] = useState<ScreenshotDecisionState>({
    selected: new Set(),
    currentIndex: 0,
    preview: screenshots.length > 0 ? screenshotData.get(screenshots[0].id) ?? null : null,
  });

  const current = screenshots[state.currentIndex];
  const progress = `${state.currentIndex + 1} / ${screenshots.length}`;

  const toggleSelection = (id: string) => {
    const newSelected = new Set(state.selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setState({ ...state, selected: newSelected });
  };

  const selectAll = () => {
    setState({
      ...state,
      selected: new Set(screenshots.map((s) => s.id)),
    });
  };

  const deselectAll = () => {
    setState({
      ...state,
      selected: new Set(),
    });
  };

  const nextScreenshot = () => {
    const nextIndex = state.currentIndex + 1;
    if (nextIndex < screenshots.length) {
      setState({
        ...state,
        currentIndex: nextIndex,
        preview: screenshotData.get(screenshots[nextIndex].id) ?? null,
      });
    }
  };

  const prevScreenshot = () => {
    const prevIndex = state.currentIndex - 1;
    if (prevIndex >= 0) {
      setState({
        ...state,
        currentIndex: prevIndex,
        preview: screenshotData.get(screenshots[prevIndex].id) ?? null,
      });
    }
  };

  const handleKeep = () => {
    onKeep(Array.from(state.selected));
  };

  return (
    <div className="screenshot-decision-ui">
      <div className="modal-overlay">
        <div className="modal-content">
          <h2>📸 Keep Successful Test Screenshots?</h2>
          <p className="subtitle">
            {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""} captured from successful test steps
          </p>

          <div className="screenshot-viewer">
            {current && (
              <>
                <div className="preview-area">
                  {state.preview && (
                    <img
                      src={`data:image/png;base64,${state.preview.toString("base64")}`}
                      alt={`Step ${current.stepIndex}`}
                      className="preview-image"
                    />
                  )}
                </div>

                <div className="screenshot-info">
                  <h3>{current.description || `Step ${current.stepIndex}`}</h3>
                  <p className="url">{current.url}</p>
                  <p className="meta">
                    {new Date(current.timestamp).toLocaleTimeString()} •{" "}
                    {Math.round((current.size ?? 0) / 1024)}KB
                  </p>
                  <p className="progress">Screenshot {progress}</p>
                </div>

                <div className="navigation">
                  <button
                    onClick={prevScreenshot}
                    disabled={state.currentIndex === 0}
                    className="nav-button"
                  >
                    ← Previous
                  </button>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${((state.currentIndex + 1) / screenshots.length) * 100}%`,
                      }}
                    />
                  </div>
                  <button
                    onClick={nextScreenshot}
                    disabled={state.currentIndex === screenshots.length - 1}
                    className="nav-button"
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="selection-list">
            <div className="list-header">
              <h4>Select screenshots to keep:</h4>
              <div className="bulk-actions">
                <button onClick={selectAll} className="action-button">
                  ✓ All
                </button>
                <button onClick={deselectAll} className="action-button">
                  ✗ None
                </button>
              </div>
            </div>

            <div className="screenshot-grid">
              {screenshots.map((screenshot) => (
                <div
                  key={screenshot.id}
                  className={`screenshot-item ${state.selected.has(screenshot.id) ? "selected" : ""}`}
                  onClick={() => toggleSelection(screenshot.id)}
                >
                  <input
                    type="checkbox"
                    checked={state.selected.has(screenshot.id)}
                    onChange={() => toggleSelection(screenshot.id)}
                    className="checkbox"
                  />
                  <div className="item-info">
                    <span className="step-label">Step {screenshot.stepIndex}</span>
                    <span className="size-label">{Math.round((screenshot.size ?? 0) / 1024)}KB</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="decision-stats">
            <span className="stat">
              {state.selected.size} selected
            </span>
            <span className="stat">
              {Math.round((Array.from(state.selected).reduce((sum, id) => {
                const s = screenshots.find(s => s.id === id);
                return sum + (s?.size ?? 0);
              }, 0) / 1024))}KB total
            </span>
          </div>

          <div className="actions">
            <button onClick={onCancel} className="button button-secondary">
              Discard All
            </button>
            <button onClick={handleKeep} className="button button-primary">
              Keep Selected ({state.selected.size})
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .screenshot-decision-ui {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 900px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 32px;
        }

        h2 {
          margin: 0 0 8px 0;
          font-size: 24px;
          color: #1a1a1a;
        }

        .subtitle {
          margin: 0 0 24px 0;
          color: #666;
          font-size: 14px;
        }

        .screenshot-viewer {
          margin-bottom: 24px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
        }

        .preview-area {
          max-height: 400px;
          overflow: hidden;
          background: #f5f5f5;
        }

        .preview-image {
          width: 100%;
          height: auto;
          display: block;
        }

        .screenshot-info {
          padding: 16px;
          background: #fafafa;
          border-top: 1px solid #e0e0e0;
        }

        .screenshot-info h3 {
          margin: 0 0 8px 0;
          font-size: 16px;
          color: #1a1a1a;
        }

        .url {
          margin: 0 0 8px 0;
          color: #0066cc;
          font-size: 12px;
          word-break: break-all;
          font-family: monospace;
        }

        .meta {
          margin: 0;
          color: #999;
          font-size: 12px;
        }

        .progress {
          margin: 8px 0 0 0;
          color: #999;
          font-size: 12px;
          font-weight: 600;
        }

        .navigation {
          display: flex;
          gap: 12px;
          padding: 12px 16px;
          border-top: 1px solid #e0e0e0;
          align-items: center;
        }

        .nav-button {
          padding: 8px 12px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .nav-button:hover:not(:disabled) {
          background: #f0f0f0;
          border-color: #ccc;
        }

        .nav-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .progress-bar {
          flex: 1;
          height: 4px;
          background: #e0e0e0;
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: #0066cc;
          transition: width 0.3s;
        }

        .selection-list {
          margin: 24px 0;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .list-header h4 {
          margin: 0;
          font-size: 14px;
          color: #1a1a1a;
        }

        .bulk-actions {
          display: flex;
          gap: 8px;
        }

        .action-button {
          padding: 4px 8px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .action-button:hover {
          background: #f0f0f0;
          border-color: #ccc;
        }

        .screenshot-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 8px;
        }

        .screenshot-item {
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .screenshot-item:hover {
          border-color: #0066cc;
          background: #f0f7ff;
        }

        .screenshot-item.selected {
          border-color: #0066cc;
          background: #e6f2ff;
        }

        .screenshot-item .checkbox {
          cursor: pointer;
        }

        .item-info {
          display: flex;
          flex-direction: column;
          font-size: 12px;
        }

        .step-label {
          font-weight: 600;
          color: #1a1a1a;
        }

        .size-label {
          color: #999;
        }

        .decision-stats {
          display: flex;
          gap: 24px;
          padding: 12px 0;
          border-top: 1px solid #e0e0e0;
          border-bottom: 1px solid #e0e0e0;
          margin-bottom: 24px;
          font-size: 13px;
        }

        .stat {
          color: #666;
        }

        .actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }

        .button {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .button-primary {
          background: #0066cc;
          color: white;
        }

        .button-primary:hover {
          background: #0052a3;
        }

        .button-secondary {
          background: #f0f0f0;
          color: #1a1a1a;
          border: 1px solid #ddd;
        }

        .button-secondary:hover {
          background: #e0e0e0;
        }
      `}</style>
    </div>
  );
}

export class UIScreenshotDecisionHandler implements ScreenshotDecisionUI {
  constructor(private onUIReady?: (ui: typeof ScreenshotDecisionUI) => void) {}

  async askToKeep(metadata: ScreenshotMetadata[]): Promise<string[]> {
    return new Promise((resolve) => {
      const screenshotData = new Map<string, Buffer>();
      // In real integration, fetch actual buffer data

      // This would be rendered in the Runora workspace UI
      if (this.onUIReady) {
        this.onUIReady(ScreenshotDecisionUI as any);
      }

      // For now, return handler that the UI will call
      (window as any).__screenshotDecisionResolve = resolve;
    });
  }

  async showScreenshot(id: string, data: Buffer): Promise<void> {
    // Display in UI
    const url = `data:image/png;base64,${data.toString("base64")}`;
    console.log(`Screenshot ${id}: ${url.slice(0, 50)}...`);
  }

  async showSummary(stats: ReturnType<ScreenshotManager["getStats"]>): Promise<void> {
    console.log(`Screenshots: ${stats.kept} kept, ${stats.pending} pending decision`);
  }
}
