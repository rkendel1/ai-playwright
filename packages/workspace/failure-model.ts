/**
 * Failure diagnosis model
 * Categorizes and captures failure information from TaskResult
 * Uses existing kernel structures where possible
 */

export type FailurePhase = "planning" | "validation" | "execution" | "assertion" | "runtime";

export type FailureCategory =
  | "planner_failed"      // Planner could not produce action
  | "validation_failed"   // Action invalid per kernel rules
  | "execution_failed"    // Browser/Playwright failed
  | "assertion_failed"    // Action succeeded, assertion failed
  | "runtime_failed"      // Obscura/browser startup/connection
  | "unknown";

export type FailureDiagnosis = {
  category: FailureCategory;
  phase: FailurePhase;
  step?: number;
  action?: {
    type: string;
    description?: string;
  };
  observation?: {
    id: string;
    url?: string;
    elementCount?: number;
  };
  validation?: {
    passed: boolean;
    reason?: string;
  };
  execution?: {
    error?: string;
    errorType?: string;
  };
  assertion?: {
    expected?: string;
    actual?: string;
    reason?: string;
  };
  message: string;
  timestamp: number;
};

export function diagnoseFailure(taskResult: any): FailureDiagnosis | null {
  if (taskResult.status === "passed") {
    return null;
  }

  // Find the failed step
  let failedStep = null;
  let failurePhase: FailurePhase = "runtime";
  let category: FailureCategory = "unknown";

  if (taskResult.steps && taskResult.steps.length > 0) {
    for (const step of taskResult.steps) {
      // Check validation failure
      if (step.validation?.status === "failure") {
        failedStep = step;
        failurePhase = "validation";
        category = "validation_failed";
        break;
      }

      // Check execution failure
      if (step.result?.status === "failure") {
        failedStep = step;
        failurePhase = "execution";
        category = "execution_failed";
        break;
      }
    }
  }

  // Check for assertion failure (all steps succeeded but assertion failed)
  if (!failedStep && taskResult.evidence) {
    const failedAssertion = taskResult.evidence.find((ev: any) => ev.result === "failed");
    if (failedAssertion) {
      failurePhase = "assertion";
      category = "assertion_failed";

      return {
        category,
        phase: failurePhase,
        assertion: {
          expected: failedAssertion.assertion,
          actual: "Not observed",
          reason: failedAssertion.detail,
        },
        message: `Assertion failed: ${failedAssertion.assertion}`,
        timestamp: Date.now(),
      };
    }
  }

  // Handle runtime failures
  if (taskResult.status === "blocked") {
    return {
      category: "runtime_failed",
      phase: "runtime",
      message: taskResult.error?.reason || "Runtime error",
      timestamp: Date.now(),
    };
  }

  if (failedStep) {
    const action = failedStep.action as any;
    const actionType = action?.type || "unknown";
    const observationId = failedStep.observation?.id;
    const observation = failedStep.observation as any;

    const diagnosis: FailureDiagnosis = {
      category,
      phase: failurePhase,
      step: failedStep.index,
      action: {
        type: actionType,
        description: describeAction(action),
      },
      observation: observationId
        ? {
            id: observationId,
            url: observation?.url,
            elementCount: observation?.elements?.length,
          }
        : undefined,
      validation:
        failurePhase === "validation"
          ? {
              passed: false,
              reason: failedStep.validation?.error,
            }
          : undefined,
      execution:
        failurePhase === "execution"
          ? {
              error: failedStep.result?.error,
              errorType: categorizeExecutionError(failedStep.result?.error),
            }
          : undefined,
      message: failedStep.result?.error || `Failed at step ${failedStep.index}: ${actionType}`,
      timestamp: Date.now(),
    };

    return diagnosis;
  }

  // Fallback
  return {
    category: "unknown",
    phase: "runtime",
    message: taskResult.error?.reason || "Test failed",
    timestamp: Date.now(),
  };
}

function describeAction(action: any): string {
  if (!action) return "unknown action";

  switch (action.type) {
    case "goto":
      return `Navigate to ${action.url}`;
    case "click":
      return `Click element`;
    case "fill":
      return `Fill text: "${action.value}"`;
    case "press":
      return `Press key: ${action.key}`;
    case "select":
      return `Select option: ${action.value}`;
    case "assert":
      return `Assert: ${action.assertion?.type || "condition"}`;
    default:
      return `${action.type}`;
  }
}

function categorizeExecutionError(error?: string): string {
  if (!error) return "unknown";
  if (error.includes("not found") || error.includes("not present")) return "target_not_found";
  if (error.includes("timeout")) return "timeout";
  if (error.includes("navigation")) return "navigation_error";
  if (error.includes("connection")) return "connection_error";
  if (error.includes("disabled") || error.includes("not enabled")) return "element_disabled";
  return "execution_error";
}
