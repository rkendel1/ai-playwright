# Screenshot Evidence Management Guide

## Overview

Capture and store screenshots of **successful test steps** for evidence, debugging, and regression detection. The UI asks whether to keep or discard screenshots at the end of each test.

## Why Screenshots on Success?

### Debugging
- "Why is this test passing?" → See exact page state at success
- Verify the right element was clicked, the right field was filled
- Catch subtle visual bugs that assertions miss

### Regression Detection
- Visual changes over time (layout, styling, content)
- Screenshot comparisons detect CSS or DOM changes
- Faster than pixel-perfect testing, more reliable than text-based

### Documentation
- Build visual runbooks from test screenshots
- Show stakeholders exactly what gets tested
- Create test step documentation automatically

### Compliance
- Regulatory proof that actions were performed
- Audit trail of test execution with evidence
- Store successful paths for reproducibility

## Architecture

```
Test Execution
    ↓
Step Completes
    ├─ Success?
    │  └─ Capture screenshot
    └─ Failure?
       └─ Capture screenshot (if enabled)
    ↓
Screenshots Pending Decision
    ↓
UI: "Keep these screenshots?"
    ├─ Preview each
    ├─ Select to keep
    └─ Discard rest
    ↓
Kept → Storage (memory/disk/cloud)
Discard → Deleted
```

## Configuration

```typescript
import { ScreenshotManager } from "./screenshot-manager.js";

const manager = new ScreenshotManager({
  captureOnSuccess: true,      // Capture successful steps
  captureOnFailure: true,      // Capture failed steps
  captureOnBlock: false,       // Don't capture blocked steps
  maxScreenshots: 100,         // Max screenshots per task
  maxStorageMB: 500,           // Max storage before cleanup
  storage: "memory",           // "memory" | "disk" | "cloud"
  compressionQuality: 80,      // PNG quality (1-100)
  autoDeleteAfterDays: 30,     // Auto-delete kept screenshots after 30 days
});
```

## Usage

### Basic Setup

```typescript
import {
  ScreenshotManager,
  ScreenshotCollector,
} from "./screenshot-manager.js";

const manager = new ScreenshotManager({
  captureOnSuccess: true,
  captureOnFailure: true,
});

const collector = new ScreenshotCollector(manager);
```

### Capture Screenshots During Test Execution

```typescript
async function executeStep(
  page: Page,
  taskId: string,
  stepIndex: number,
  stepDescription: string,
  action: BrowserAction
) {
  // Execute the action
  let status: "success" | "failure" | "blocked";
  try {
    await executor.execute(action, observation);
    status = "success";
  } catch (error) {
    status = "failure";
  }

  // Capture screenshot based on status
  const screenshot = await collector.collectForStep(
    page,
    taskId,
    stepIndex,
    stepDescription,
    status
  );

  if (screenshot) {
    console.log(
      `📸 Captured: ${screenshot.description} (${Math.round((screenshot.size ?? 0) / 1024)}KB)`
    );
  }

  return { status, screenshot };
}
```

### Ask User About Screenshots

```typescript
async function finishTask(taskId: string) {
  const result = await collector.askAboutScreenshots(taskId);

  console.log(`
    Screenshots decision:
    - Kept: ${result.kept}
    - Discarded: ${result.discarded}
  `);

  // Show final stats
  const stats = manager.getStats();
  console.log(`
    Storage:
    - Total screenshots: ${stats.total}
    - Kept: ${stats.kept}
    - Pending: ${stats.pending}
    - Storage used: ${stats.totalSizeMB}MB
  `);
}
```

## UI Integration

### React Component

The workspace includes `ScreenshotDecisionUI` component:

```typescript
import { ScreenshotDecisionUI } from "./screenshot-ui.js";

function TestRunnerWorkspace() {
  const [screenshots, setScreenshots] = useState<ScreenshotMetadata[]>([]);
  const [showDecision, setShowDecision] = useState(false);

  const handleKeepScreenshots = (ids: string[]) => {
    for (const id of ids) {
      manager.keepScreenshot(id);
    }
    setShowDecision(false);
  };

  return (
    <>
      {showDecision && (
        <ScreenshotDecisionUI
          screenshots={manager.getScreenshotsNeedingDecision()}
          screenshotData={/* map of id -> buffer */}
          onKeep={handleKeepScreenshots}
          onCancel={() => {
            manager.clear(); // Discard all
            setShowDecision(false);
          }}
        />
      )}
    </>
  );
}
```

### UI Features

- **Preview**: View each screenshot full-size
- **Navigation**: Previous/Next to browse screenshots
- **Bulk Selection**: Select All / Deselect All
- **Individual Selection**: Toggle each screenshot
- **Size Display**: See storage impact of selection
- **Metadata**: URL, timestamp, step number visible
- **Progress**: Visual indicator of progress through screenshots

## Screenshot Organization

### By Task

```typescript
// Get all screenshots for a specific task
const taskScreenshots = manager.getAllScreenshots("github-search-task");

// Get kept screenshots only
const kept = manager.getKeptScreenshots("github-search-task");

// Get pending screenshots (need decision)
const pending = manager.getScreenshotsNeedingDecision("github-search-task");
```

### By Status

```typescript
// Screenshots are metadata with step info
const step5Screenshots = manager
  .getAllScreenshots()
  .filter((s) => s.stepIndex === 5);
```

### By Time

```typescript
// Screenshots have timestamp
const recent = manager
  .getAllScreenshots()
  .sort((a, b) => b.timestamp - a.timestamp)
  .slice(0, 10); // Last 10
```

## Storage Strategy

### Memory (Development)
```typescript
storage: "memory"  // Keeps in-process, cleared on exit
```

### Disk (Testing)
```typescript
storage: "disk"    // Saves to filesystem
// Directory: .runora/screenshots/{taskId}/
```

### Cloud (Team/CI)
```typescript
storage: "cloud"   // Sends to cloud storage
// Requires: S3, GCS, or similar integration
```

## Automatic Cleanup

The manager automatically manages storage:

```typescript
// When max screenshots exceeded
if (screenshots.size > maxScreenshots) {
  deleteOldest();  // Delete oldest screenshot
}

// When max storage exceeded
if (totalSize > maxStorageMB * 1024 * 1024) {
  cleanupOldest();  // Delete oldest 20%
}

// Expire old kept screenshots
manager.expireOldScreenshots();  // Call periodically
```

## Example: Full Test with Screenshots

```typescript
async function runTestWithEvidence(goal: string, url: string) {
  const taskId = crypto.randomUUID();
  const manager = new ScreenshotManager({ captureOnSuccess: true });
  const collector = new ScreenshotCollector(manager);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Initialize for test
    let stepIndex = 0;

    // Step 1: Navigate
    await page.goto(url);
    await collector.collectForStep(page, taskId, stepIndex++, "Navigate to site", "success");

    // Step 2: Search
    const observation = await observe(page);
    const action = await planner.plan(observation, goal);
    await executor.execute(action, observation);
    await collector.collectForStep(page, taskId, stepIndex++, "Perform search", "success");

    // Step 3: Verify results
    const finalObservation = await observe(page);
    const hasResults = finalObservation.elements.some(
      (e) => e.name?.includes("result")
    );
    await collector.collectForStep(
      page,
      taskId,
      stepIndex++,
      "Verify results",
      hasResults ? "success" : "failure"
    );

    // Ask about screenshots
    const decision = await collector.askAboutScreenshots(taskId);
    console.log(`Kept ${decision.kept} screenshots, discarded ${decision.discarded}`);

    // Return kept screenshots with result
    return {
      status: "passed",
      screenshots: manager.getKeptScreenshots(taskId),
      stats: manager.getStats(),
    };
  } finally {
    await browser.close();
  }
}
```

## Integration with Evidence System

Screenshots are part of the larger evidence system:

```typescript
type Evidence = 
  | { type: "assertion"; assertion: string; result: "passed" | "failed" }
  | { type: "screenshot"; screenshotId: string; step: number }
  | { type: "trace"; traceFile: string }
  | { type: "video"; videoFile: string };

// Store screenshot references with evidence
const evidence: Evidence[] = [
  { type: "assertion", assertion: "results visible", result: "passed" },
  { type: "screenshot", screenshotId: "task-123-step1", step: 1 },
  { type: "screenshot", screenshotId: "task-123-step3", step: 3 },
];
```

## Accessing Kept Screenshots

### In Test Report

```typescript
function generateTestReport(taskId: string) {
  const screenshots = manager.getKeptScreenshots(taskId);

  return `
    # Test Report

    ## Evidence

    ${screenshots
      .map(
        (s) => `
        ### Step ${s.stepIndex}: ${s.description}
        - Captured: ${new Date(s.timestamp).toLocaleString()}
        - URL: ${s.url}
        - Size: ${Math.round((s.size ?? 0) / 1024)}KB

        ![Screenshot](screenshots/${s.id}.png)
        `
      )
      .join("\n")}
  `;
}
```

### API for External Tools

```typescript
// Get screenshot by ID
const screenshot = await manager.getScreenshot("task-123-step1");
const { data, metadata } = screenshot;

// Send to external service
await uploadToSlack(data, `Step ${metadata.stepIndex}`);
await uploadToJira(data, `Evidence for ${metadata.taskId}`);
await uploadToS3(data, `screenshots/${metadata.taskId}/${metadata.id}.png`);
```

## Configuration Presets

### Development (Keep Everything)
```typescript
{
  captureOnSuccess: true,
  captureOnFailure: true,
  captureOnBlock: true,
  maxScreenshots: 1000,
  maxStorageMB: 2000,
  autoDeleteAfterDays: 365,  // Keep for 1 year
}
```

### Testing (Selective)
```typescript
{
  captureOnSuccess: true,
  captureOnFailure: true,
  captureOnBlock: false,
  maxScreenshots: 100,
  maxStorageMB: 500,
  autoDeleteAfterDays: 30,
}
```

### Production (Failures Only)
```typescript
{
  captureOnSuccess: false,
  captureOnFailure: true,
  captureOnBlock: false,
  maxScreenshots: 50,
  maxStorageMB: 100,
  autoDeleteAfterDays: 7,
}
```

## Best Practices

1. **Ask for Confirmation**: Always let user decide what to keep
2. **Show Previews**: Let user see screenshots before deciding
3. **Provide Context**: Include step description, URL, timestamp
4. **Set Limits**: Don't let screenshots consume infinite storage
5. **Auto-Expire**: Delete old kept screenshots after N days
6. **Reference in Reports**: Link screenshots to test results
7. **Compress**: Use reasonable compression quality (80-85 is good)

## Troubleshooting

### Storage Filling Up

Check and clean up:
```typescript
const stats = manager.getStats();
if (stats.totalSizeMB > 400) {
  manager.expireOldScreenshots();
  manager.clear();  // Clear all if needed
}
```

### Screenshots Not Captured

Verify configuration:
```typescript
const config = manager["config"];
console.log({
  captureOnSuccess: config.captureOnSuccess,
  captureOnFailure: config.captureOnFailure,
  captureOnBlock: config.captureOnBlock,
});
```

### UI Not Showing Decision Prompt

Ensure collector has UI:
```typescript
const collector = new ScreenshotCollector(
  manager,
  new UIScreenshotDecisionHandler()  // ← Pass UI handler
);
```

## Future Enhancements

1. **Visual Diff**: Compare screenshots to detect regressions
2. **OCR Integration**: Extract text from screenshots for search
3. **Cloud Sync**: Auto-upload kept screenshots to cloud
4. **Screenshot Gallery**: Browse all screenshots by task/date
5. **Baseline Comparison**: Alert on visual changes vs baseline
