import React, { useState, useRef, useEffect } from "react";
import type { TestDefinition } from "./test-model.js";
import { FlowControlUI, StepEditor } from "./flow-control-ui.js";
import { FlowOrchestrator, FlowParser } from "../core/flow-orchestrator.js";

interface TestEditorProps {
  mode: "create" | "edit";
  test?: TestDefinition;
  onSubmit: (test: TestDefinition) => void;
  onCancel: () => void;
  availableSecrets: Array<{ id: string; name: string; kind: string }>;
}

export function TestEditor({
  mode,
  test,
  onSubmit,
  onCancel,
  availableSecrets,
}: TestEditorProps) {
  const [name, setName] = useState(test?.name || "");
  const [url, setUrl] = useState(test?.url || "");
  const [taskDescription, setTaskDescription] = useState(test?.task || "");
  const [secretProfileIds, setSecretProfileIds] = useState<string[]>(
    test?.secretProfileIds || []
  );
  const [showFlowPreview, setShowFlowPreview] = useState(false);
  const [flowSteps, setFlowSteps] = useState<any[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  const handleParseFlow = (description: string) => {
    const steps = FlowParser.parse(description);
    setFlowSteps(steps);
    setShowFlowPreview(true);
  };

  const handleToggleSecret = (secretId: string) => {
    setSecretProfileIds((prev) => {
      if (prev.includes(secretId)) {
        return prev.filter((id) => id !== secretId);
      } else {
        return [...prev, secretId];
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert("Please enter a test name");
      return;
    }

    if (!url.trim()) {
      alert("Please enter a URL");
      return;
    }

    if (!taskDescription.trim()) {
      alert("Please enter test steps or task description");
      return;
    }

    const updatedTest: TestDefinition = {
      id: test?.id || `test-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      task: taskDescription.trim(),
      secretProfileIds: secretProfileIds.length > 0 ? secretProfileIds : undefined,
      // Legacy support: use first secret if available
      secretProfileId: secretProfileIds[0],
    };

    onSubmit(updatedTest);
  };

  return (
    <div className="test-editor-container">
      {!showFlowPreview ? (
        <form onSubmit={handleSubmit} className="test-editor-form">
          <div className="form-section">
            <h2>{mode === "create" ? "New Test" : "Edit Test"}</h2>
            <p className="form-description">
              {mode === "create"
                ? "Create a new Runora workspace test with structured flow steps."
                : "Update the selected workspace test."}
            </p>
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="test-name">Name</label>
              <input
                id="test-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Login and create idea"
                autoComplete="off"
              />
            </div>

            <div className="form-field">
              <label htmlFor="test-url">URL</label>
              <input
                id="test-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000"
                autoComplete="off"
              />
            </div>

            <div className="form-field full-width">
              <label>Task / Test Steps</label>
              <StepEditor
                testDescription={taskDescription}
                onChange={setTaskDescription}
                onParse={handleParseFlow}
              />
              <button
                type="button"
                onClick={() => handleParseFlow(taskDescription)}
                className="secondary-button"
                style={{ marginTop: "8px" }}
              >
                Preview Flow Steps
              </button>
            </div>

            <div className="form-field full-width">
              <label>Credentials Needed</label>
              <div className="secrets-grid">
                {availableSecrets.length > 0 ? (
                  availableSecrets.map((secret) => (
                    <label key={secret.id} className="secret-checkbox">
                      <input
                        type="checkbox"
                        checked={secretProfileIds.includes(secret.id)}
                        onChange={() => handleToggleSecret(secret.id)}
                      />
                      <span>
                        {secret.name}
                        <small className="muted"> ({secret.kind})</small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="muted">No saved credentials. Use "Secrets Vault" to add them.</p>
                )}
              </div>
              <small className="muted">
                Tests can reference multiple credential profiles. Values remain encrypted and never
                written to test definitions.
              </small>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onCancel} className="ghost-button">
              Cancel
            </button>
            <button type="submit" className="primary-button">
              {mode === "create" ? "Create Test" : "Update Test"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flow-preview">
          <button
            type="button"
            onClick={() => setShowFlowPreview(false)}
            className="ghost-button"
            style={{ marginBottom: "16px" }}
          >
            ← Back to Editor
          </button>

          <FlowControlUI
            steps={flowSteps}
            currentStepIndex={currentStepIndex}
            isPaused={isPaused}
            breakpoints={breakpoints}
            onResume={async () => setIsPaused(false)}
            onPause={async () => setIsPaused(true)}
            onStepClick={async (idx) => setCurrentStepIndex(idx)}
            onSetBreakpoint={(idx) =>
              setBreakpoints(new Set(breakpoints).add(idx))
            }
            onClearBreakpoint={(idx) => {
              const newSet = new Set(breakpoints);
              newSet.delete(idx);
              setBreakpoints(newSet);
            }}
            onSkipStep={async (idx) => {
              setCurrentStepIndex(idx + 1);
            }}
          />
        </div>
      )}

      <style>{`
        .test-editor-container {
          width: 100%;
        }

        .test-editor-form {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .form-section {
          border-bottom: 1px solid #dce6f5;
          padding-bottom: 16px;
        }

        .form-section h2 {
          margin: 0 0 8px 0;
          font-size: 24px;
          color: #10233f;
        }

        .form-description {
          margin: 0;
          color: #5d7694;
          font-size: 14px;
        }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-field.full-width {
          grid-column: 1 / -1;
        }

        .form-field label {
          font-weight: 600;
          color: #10233f;
          font-size: 14px;
        }

        .form-field input,
        .form-field textarea,
        .form-field select {
          padding: 10px 12px;
          border: 1px solid #dce6f5;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
        }

        .form-field input:focus,
        .form-field textarea:focus,
        .form-field select:focus {
          outline: none;
          border-color: #335eea;
          box-shadow: 0 0 0 3px rgba(51, 94, 234, 0.1);
        }

        .form-field textarea {
          min-height: 120px;
          resize: vertical;
          font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
          font-size: 13px;
        }

        .secrets-grid {
          display: grid;
          gap: 10px;
          padding: 12px;
          background: #f8fbff;
          border: 1px solid #e8f1ff;
          border-radius: 8px;
        }

        .secret-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 14px;
          padding: 6px;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .secret-checkbox:hover {
          background: rgba(51, 94, 234, 0.05);
        }

        .secret-checkbox input[type="checkbox"] {
          cursor: pointer;
          width: 16px;
          height: 16px;
        }

        .secret-checkbox small {
          font-size: 12px;
        }

        .muted {
          color: #5d7694;
        }

        .form-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          border-top: 1px solid #dce6f5;
          padding-top: 16px;
        }

        .primary-button,
        .secondary-button,
        .ghost-button {
          border: 0;
          border-radius: 12px;
          cursor: pointer;
          padding: 12px 16px;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.2s;
        }

        .primary-button {
          background: linear-gradient(135deg, #335eea, #2647b8);
          color: white;
        }

        .primary-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(51, 94, 234, 0.3);
        }

        .secondary-button {
          background: #eef4ff;
          color: #2347b1;
        }

        .secondary-button:hover {
          background: #dce6f5;
        }

        .ghost-button {
          background: transparent;
          color: #49617f;
        }

        .ghost-button:hover {
          background: #f3f6fb;
        }

        .flow-preview {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
      `}</style>
    </div>
  );
}

export default TestEditor;
