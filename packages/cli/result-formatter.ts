import type { FailureDiagnosis } from "../workspace/failure-model.js";

/**
 * Format test results for CLI output
 * Shows useful failure information for diagnostics
 */

export function formatRunResult(
  testName: string,
  status: "passed" | "failed" | "blocked",
  durationMs: number,
  failure?: FailureDiagnosis,
  taskResult?: any
): string {
  const statusEmoji = status === "passed" ? "✅" : status === "failed" ? "❌" : "⊘";
  const durationSec = (durationMs / 1000).toFixed(1);

  let output = `\n${statusEmoji} ${testName}\n`;
  output += `${status.toUpperCase()} (${durationSec}s)\n`;

  if (status === "passed") {
    if (taskResult?.evidence?.length > 0) {
      output += `\nAssertions: ${taskResult.evidence.length}\n`;
      taskResult.evidence.forEach((ev: any) => {
        const icon = ev.result === "passed" ? "✓" : "✗";
        output += `  ${icon} ${ev.assertion}\n`;
      });
    }
    if (taskResult?.steps?.length > 0) {
      output += `\nSteps: ${taskResult.steps.length}\n`;
      taskResult.steps.forEach((step: any) => {
        const actionType = step.action?.type || "observe";
        output += `  ✓ [${step.index}] ${actionType}\n`;
      });
    }
    return output;
  }

  if (!failure) {
    return output;
  }

  // Format failure details
  output += `\nFailure Category\n`;
  output += `  ${categorizeFailureForDisplay(failure.category)}\n`;

  if (failure.step !== undefined) {
    output += `\nStep\n`;
    output += `  ${failure.step} / ${failure.step + 1}\n`;
  }

  if (failure.action) {
    output += `\nAction\n`;
    output += `  ${failure.action.description || failure.action.type}\n`;
  }

  if (failure.observation?.url) {
    output += `\nURL\n`;
    output += `  ${failure.observation.url}\n`;
  }

  if (failure.execution?.error || failure.assertion?.reason || failure.message) {
    output += `\nReason\n`;
    const reason =
      failure.execution?.error || failure.assertion?.reason || failure.message;
    output += `  ${reason}\n`;
  }

  if (failure.observation?.elementCount !== undefined) {
    output += `\nObservation\n`;
    output += `  ${failure.observation.elementCount} elements visible\n`;
  }

  return output;
}

function categorizeFailureForDisplay(category: string): string {
  switch (category) {
    case "planner_failed":
      return "Planner could not produce an action";
    case "validation_failed":
      return "Action failed validation";
    case "execution_failed":
      return "Browser execution failed";
    case "assertion_failed":
      return "Assertion failed";
    case "runtime_failed":
      return "Runtime/browser startup failed";
    default:
      return "Unknown failure";
  }
}

export function formatRunSummary(results: Array<{
  testId: string;
  status: "passed" | "failed" | "blocked";
}>): string {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked = results.filter((r) => r.status === "blocked").length;

  let output = `\nSummary\n`;
  if (passed > 0) output += `  ${passed} passed\n`;
  if (failed > 0) output += `  ${failed} failed\n`;
  if (blocked > 0) output += `  ${blocked} blocked\n`;

  return output;
}
