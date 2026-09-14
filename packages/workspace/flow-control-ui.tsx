import React, { useState } from "react";
import type { TestStep, ExecutionContext } from "../core/flow-orchestrator.js";

interface FlowControlUIProps {
  steps: TestStep[];
  currentStepIndex: number;
  isPaused: boolean;
  pausedReason?: string;
  breakpoints: Set<number>;
  onResume: () => Promise<void>;
  onPause: () => Promise<void>;
  onStepClick: (stepIndex: number) => Promise<void>;
  onSetBreakpoint: (stepIndex: number) => void;
  onClearBreakpoint: (stepIndex: number) => void;
  onSkipStep: (stepIndex: number) => Promise<void>;
}

export function FlowControlUI({
  steps,
  currentStepIndex,
  isPaused,
  pausedReason,
  breakpoints,
  onResume,
  onPause,
  onStepClick,
  onSetBreakpoint,
  onClearBreakpoint,
  onSkipStep,
}: FlowControlUIProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleResume = async () => {
    setIsLoading(true);
    try {
      await onResume();
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async () => {
    setIsLoading(true);
    try {
      await onPause();
    } finally {
      setIsLoading(false);
    }
  };

  const handleStepClick = async (index: number) => {
    if (steps[index].status === "pending") {
      setIsLoading(true);
      try {
        await onStepClick(index);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSkipStep = async (index: number) => {
    setIsLoading(true);
    try {
      await onSkipStep(index);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBreakpoint = (index: number) => {
    if (breakpoints.has(index)) {
      onClearBreakpoint(index);
    } else {
      onSetBreakpoint(index);
    }
  };

  return (
    <div className="flow-control-ui">
      <div className="flow-header">
        <h3>Test Flow Execution</h3>
        <div className="flow-controls">
          {isPaused ? (
            <button onClick={handleResume} disabled={isLoading} className="button button-primary">
              ▶ Resume
            </button>
          ) : (
            <button onClick={handlePause} disabled={isLoading} className="button button-secondary">
              ⏸ Pause
            </button>
          )}
        </div>
      </div>

      {isPaused && pausedReason && (
        <div className="pause-notice">
          <div className="pause-icon">⏸</div>
          <div className="pause-message">
            <strong>Paused:</strong> {pausedReason}
          </div>
          <button onClick={handleResume} disabled={isLoading} className="resume-btn">
            Continue
          </button>
        </div>
      )}

      <div className="steps-container">
        <div className="steps-list">
          {steps.map((step, index) => (
            <div key={step.id} className={`step-item step-${step.status}`}>
              <div className="step-header">
                <div className="step-number-and-status">
                  <span className="step-number">{index + 1}</span>
                  <span className="step-status-badge">{step.status.toUpperCase()}</span>
                </div>

                <div className="step-controls">
                  <button
                    onClick={() => toggleBreakpoint(index)}
                    title={breakpoints.has(index) ? "Remove breakpoint" : "Add breakpoint"}
                    className={`breakpoint-btn ${breakpoints.has(index) ? "active" : ""}`}
                  >
                    🔴
                  </button>

                  {step.status === "failure" && (
                    <button
                      onClick={() => handleSkipStep(index)}
                      disabled={isLoading}
                      className="skip-btn"
                      title="Skip this step and continue"
                    >
                      ⊘ Skip
                    </button>
                  )}

                  {step.status === "pending" && isPaused && index === currentStepIndex + 1 && (
                    <button
                      onClick={() => handleStepClick(index)}
                      disabled={isLoading}
                      className="execute-btn"
                      title="Execute this step"
                    >
                      → Execute
                    </button>
                  )}
                </div>
              </div>

              <div className="step-content">
                <div className="step-type-badge">{step.type}</div>
                <div className="step-description">{step.description}</div>

                {step.instruction && step.type === "natural" && (
                  <div className="step-instruction">💡 {step.instruction}</div>
                )}

                {step.error && (
                  <div className="step-error">
                    <strong>Error:</strong> {step.error}
                  </div>
                )}

                {step.result && (
                  <div className="step-result">
                    <strong>Result:</strong> {JSON.stringify(step.result, null, 2)}
                  </div>
                )}

                {step.completedAt && step.startedAt && (
                  <div className="step-timing">
                    ⏱ {step.completedAt - step.startedAt}ms
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .flow-control-ui {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #f9f9f9;
          border-radius: 8px;
          overflow: hidden;
        }

        .flow-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: #fff;
          border-bottom: 1px solid #e0e0e0;
        }

        .flow-header h3 {
          margin: 0;
          font-size: 16px;
          color: #1a1a1a;
        }

        .flow-controls {
          display: flex;
          gap: 8px;
        }

        .pause-notice {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: #fff3cd;
          border-left: 4px solid #ffc107;
          margin: 12px;
          border-radius: 4px;
        }

        .pause-icon {
          font-size: 20px;
        }

        .pause-message {
          flex: 1;
          font-size: 14px;
          color: #856404;
        }

        .resume-btn {
          padding: 6px 12px;
          background: #ffc107;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
        }

        .resume-btn:hover {
          background: #ffb300;
        }

        .steps-container {
          padding: 12px;
          max-height: 600px;
          overflow-y: auto;
        }

        .steps-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .step-item {
          background: white;
          border: 2px solid #e0e0e0;
          border-radius: 6px;
          padding: 12px;
          transition: all 0.2s;
        }

        .step-item:hover {
          border-color: #0066cc;
          box-shadow: 0 2px 8px rgba(0, 102, 204, 0.1);
        }

        .step-item.step-success {
          border-color: #28a745;
          background: #f0fff4;
        }

        .step-item.step-failure {
          border-color: #dc3545;
          background: #fff5f5;
        }

        .step-item.step-paused {
          border-color: #ffc107;
          background: #fffbf0;
        }

        .step-item.step-running {
          border-color: #0066cc;
          background: #f0f7ff;
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(0, 102, 204, 0.3);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(0, 102, 204, 0);
          }
        }

        .step-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .step-number-and-status {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .step-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background: #0066cc;
          color: white;
          border-radius: 50%;
          font-weight: 600;
          font-size: 12px;
        }

        .step-status-badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          background: #e0e0e0;
          border-radius: 3px;
          color: #666;
        }

        .step-item.step-success .step-status-badge {
          background: #d4edda;
          color: #155724;
        }

        .step-item.step-failure .step-status-badge {
          background: #f8d7da;
          color: #721c24;
        }

        .step-item.step-running .step-status-badge {
          background: #d1ecf1;
          color: #0c5460;
        }

        .step-controls {
          display: flex;
          gap: 4px;
        }

        .breakpoint-btn,
        .skip-btn,
        .execute-btn {
          padding: 4px 8px;
          border: 1px solid #ddd;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          transition: all 0.2s;
        }

        .breakpoint-btn {
          font-size: 14px;
          padding: 2px 6px;
        }

        .breakpoint-btn.active {
          background: #ffcdd2;
        }

        .breakpoint-btn:hover {
          background: #f5f5f5;
        }

        .skip-btn:hover {
          background: #f8d7da;
          border-color: #dc3545;
          color: #dc3545;
        }

        .execute-btn:hover {
          background: #d1ecf1;
          border-color: #0066cc;
          color: #0066cc;
        }

        .step-content {
          margin-top: 8px;
        }

        .step-type-badge {
          display: inline-block;
          padding: 2px 8px;
          background: #e8f4fd;
          color: #0066cc;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 6px;
        }

        .step-description {
          font-size: 14px;
          color: #1a1a1a;
          margin-bottom: 4px;
        }

        .step-instruction {
          font-size: 12px;
          color: #666;
          margin-top: 4px;
          padding: 4px 8px;
          background: #f9f9f9;
          border-left: 2px solid #0066cc;
        }

        .step-error {
          font-size: 12px;
          color: #dc3545;
          margin-top: 4px;
          padding: 4px 8px;
          background: #fff5f5;
          border-left: 2px solid #dc3545;
        }

        .step-result {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
          padding: 4px 8px;
          background: #f5f5f5;
          border-left: 2px solid #28a745;
          font-family: monospace;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .step-timing {
          font-size: 11px;
          color: #999;
          margin-top: 4px;
        }

        .button {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s;
        }

        .button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .button-primary {
          background: #0066cc;
          color: white;
          border-color: #0066cc;
        }

        .button-primary:hover:not(:disabled) {
          background: #0052a3;
        }

        .button-secondary {
          background: white;
          color: #1a1a1a;
        }

        .button-secondary:hover:not(:disabled) {
          background: #f0f0f0;
        }
      `}</style>
    </div>
  );
}

interface StepEditorProps {
  testDescription: string;
  onChange: (description: string) => void;
  onParse: (description: string) => void;
}

export function StepEditor({ testDescription, onChange, onParse }: StepEditorProps) {
  return (
    <div className="step-editor">
      <div className="editor-header">
        <h3>Test Description</h3>
        <button onClick={() => onParse(testDescription)} className="button button-primary">
          Parse Steps
        </button>
      </div>

      <textarea
        value={testDescription}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter your test steps. Examples:
Click "Search" button
Fill search box with "great dane puppies"
Wait for results to load
Screenshot
Pause: Check results manually
Assert "results visible"
Navigate to "https://example.com"`}
        className="editor-textarea"
      />

      <style>{`
        .step-editor {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .editor-header h3 {
          margin: 0;
          font-size: 16px;
          color: #1a1a1a;
        }

        .editor-textarea {
          width: 100%;
          height: 200px;
          padding: 12px;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          font-family: monospace;
          font-size: 13px;
          line-height: 1.5;
          resize: vertical;
        }

        .editor-textarea:focus {
          outline: none;
          border-color: #0066cc;
          box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
        }
      `}</style>
    </div>
  );
}
