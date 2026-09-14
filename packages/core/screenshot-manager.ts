import type { Page } from "playwright";

export type ScreenshotMetadata = {
  id: string;
  timestamp: number;
  url: string;
  stepIndex: number;
  taskId: string;
  description?: string;
  size?: number;
  mimeType: "image/png" | "image/jpeg";
  kept: boolean;
  expiresAt?: number;
};

export type ScreenshotStorage = "memory" | "disk" | "cloud";

export type ScreenshotManagerConfig = {
  captureOnSuccess?: boolean;
  captureOnFailure?: boolean;
  captureOnBlock?: boolean;
  maxScreenshots?: number;
  maxStorageMB?: number;
  storage?: ScreenshotStorage;
  compressionQuality?: number;
  autoDeleteAfterDays?: number;
};

export class ScreenshotManager {
  private screenshots: Map<string, { data: Buffer; metadata: ScreenshotMetadata }> = new Map();
  private totalSize = 0;

  constructor(private config: ScreenshotManagerConfig = {}) {
    this.config = {
      captureOnSuccess: true,
      captureOnFailure: true,
      captureOnBlock: false,
      maxScreenshots: 100,
      maxStorageMB: 500,
      storage: "memory",
      compressionQuality: 80,
      autoDeleteAfterDays: 30,
      ...config,
    };
  }

  async captureScreenshot(
    page: Page,
    taskId: string,
    stepIndex: number,
    description?: string
  ): Promise<ScreenshotMetadata | null> {
    try {
      const screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
      });

      const url = page.url();
      const id = `${taskId}-step${stepIndex}-${Date.now()}`;

      const metadata: ScreenshotMetadata = {
        id,
        timestamp: Date.now(),
        url,
        stepIndex,
        taskId,
        description,
        size: screenshotBuffer.length,
        mimeType: "image/png",
        kept: false, // Initially not kept (pending user decision)
      };

      this.screenshots.set(id, {
        data: screenshotBuffer,
        metadata,
      });

      this.totalSize += screenshotBuffer.length;

      // Auto-cleanup if exceeding limits
      if (this.totalSize > (this.config.maxStorageMB ?? 500) * 1024 * 1024) {
        this.cleanupOldest();
      }

      if (this.screenshots.size > (this.config.maxScreenshots ?? 100)) {
        this.deleteOldest();
      }

      return metadata;
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      return null;
    }
  }

  async keepScreenshot(screenshotId: string): Promise<boolean> {
    const entry = this.screenshots.get(screenshotId);
    if (!entry) return false;

    entry.metadata.kept = true;

    // Set expiration based on config
    if (this.config.autoDeleteAfterDays) {
      entry.metadata.expiresAt =
        Date.now() + this.config.autoDeleteAfterDays * 24 * 60 * 60 * 1000;
    }

    return true;
  }

  async discardScreenshot(screenshotId: string): Promise<boolean> {
    const entry = this.screenshots.get(screenshotId);
    if (!entry) return false;

    this.totalSize -= entry.metadata.size ?? 0;
    this.screenshots.delete(screenshotId);
    return true;
  }

  async getScreenshot(
    screenshotId: string
  ): Promise<{ data: Buffer; metadata: ScreenshotMetadata } | null> {
    return this.screenshots.get(screenshotId) ?? null;
  }

  getKeptScreenshots(taskId?: string): ScreenshotMetadata[] {
    const kept = Array.from(this.screenshots.values())
      .filter((entry) => entry.metadata.kept)
      .map((entry) => entry.metadata);

    if (taskId) {
      return kept.filter((s) => s.taskId === taskId);
    }

    return kept;
  }

  getAllScreenshots(taskId?: string): ScreenshotMetadata[] {
    const all = Array.from(this.screenshots.values()).map(
      (entry) => entry.metadata
    );

    if (taskId) {
      return all.filter((s) => s.taskId === taskId);
    }

    return all;
  }

  getScreenshotsNeedingDecision(taskId?: string): ScreenshotMetadata[] {
    const pending = Array.from(this.screenshots.values())
      .filter((entry) => !entry.metadata.kept && !entry.metadata.expiresAt)
      .map((entry) => entry.metadata);

    if (taskId) {
      return pending.filter((s) => s.taskId === taskId);
    }

    return pending;
  }

  private cleanupOldest(): void {
    const sorted = Array.from(this.screenshots.entries()).sort(
      (a, b) => a[1].metadata.timestamp - b[1].metadata.timestamp
    );

    const toDelete = Math.ceil(sorted.length * 0.2); // Delete oldest 20%
    for (let i = 0; i < toDelete; i++) {
      const [id, entry] = sorted[i];
      this.totalSize -= entry.metadata.size ?? 0;
      this.screenshots.delete(id);
    }
  }

  private deleteOldest(): void {
    const oldest = Array.from(this.screenshots.entries()).reduce((a, b) =>
      a[1].metadata.timestamp < b[1].metadata.timestamp ? a : b
    );

    if (oldest) {
      this.totalSize -= oldest[1].metadata.size ?? 0;
      this.screenshots.delete(oldest[0]);
    }
  }

  getStats(): {
    total: number;
    kept: number;
    pending: number;
    totalSizeMB: number;
  } {
    const all = Array.from(this.screenshots.values());
    const keptCount = all.filter((e) => e.metadata.kept).length;
    const pendingCount = all.filter((e) => !e.metadata.kept && !e.metadata.expiresAt)
      .length;

    return {
      total: all.length,
      kept: keptCount,
      pending: pendingCount,
      totalSizeMB: Math.round((this.totalSize / 1024 / 1024) * 100) / 100,
    };
  }

  clear(taskId?: string): void {
    if (taskId) {
      const toDelete = Array.from(this.screenshots.entries())
        .filter(([, entry]) => entry.metadata.taskId === taskId)
        .map(([id]) => id);

      for (const id of toDelete) {
        const entry = this.screenshots.get(id);
        if (entry) {
          this.totalSize -= entry.metadata.size ?? 0;
          this.screenshots.delete(id);
        }
      }
    } else {
      this.screenshots.clear();
      this.totalSize = 0;
    }
  }

  expireOldScreenshots(): number {
    const now = Date.now();
    let deleted = 0;

    for (const [id, entry] of this.screenshots.entries()) {
      if (entry.metadata.expiresAt && entry.metadata.expiresAt < now) {
        this.totalSize -= entry.metadata.size ?? 0;
        this.screenshots.delete(id);
        deleted++;
      }
    }

    return deleted;
  }
}

export type ScreenshotDecisionUI = {
  askToKeep(metadata: ScreenshotMetadata[]): Promise<string[]>; // Returns IDs to keep
  showScreenshot(id: string, data: Buffer): Promise<void>;
  showSummary(stats: ReturnType<ScreenshotManager["getStats"]>): Promise<void>;
};

export class ScreenshotDecisionPrompt implements ScreenshotDecisionUI {
  async askToKeep(metadata: ScreenshotMetadata[]): Promise<string[]> {
    if (metadata.length === 0) return [];

    const kept: string[] = [];

    // In a real UI, this would show interactive prompts
    // For now, return a format for the UI to handle
    console.log(`
[Screenshot Decision Required]
Found ${metadata.length} screenshots from successful test steps.

Screenshots:
${metadata
  .map(
    (s, i) =>
      `
  ${i + 1}. Step ${s.stepIndex} - ${s.description || s.url}
     Captured: ${new Date(s.timestamp).toLocaleTimeString()}
     Size: ${Math.round((s.size ?? 0) / 1024)}KB
`
  )
  .join("")}

Decision: (For UI integration, return array of IDs to keep)
    `);

    return kept;
  }

  async showScreenshot(id: string, data: Buffer): Promise<void> {
    console.log(`[Screenshot] ID: ${id}, Size: ${data.length} bytes`);
    // In a real UI, display the image
  }

  async showSummary(stats: ReturnType<ScreenshotManager["getStats"]>): Promise<void> {
    console.log(`
[Screenshot Summary]
  Total: ${stats.total}
  Kept: ${stats.kept}
  Pending decision: ${stats.pending}
  Storage: ${stats.totalSizeMB}MB
    `);
  }
}

export class ScreenshotCollector {
  constructor(
    private manager: ScreenshotManager,
    private ui?: ScreenshotDecisionUI
  ) {}

  async collectForStep(
    page: Page,
    taskId: string,
    stepIndex: number,
    stepDescription: string,
    stepStatus: "success" | "failure" | "blocked"
  ): Promise<ScreenshotMetadata | null> {
    const config = this.manager["config"];

    // Decide whether to capture based on status
    const shouldCapture =
      (stepStatus === "success" && config.captureOnSuccess) ||
      (stepStatus === "failure" && config.captureOnFailure) ||
      (stepStatus === "blocked" && config.captureOnBlock);

    if (!shouldCapture) {
      return null;
    }

    return this.manager.captureScreenshot(
      page,
      taskId,
      stepIndex,
      `${stepStatus.toUpperCase()}: ${stepDescription}`
    );
  }

  async askAboutScreenshots(
    taskId: string
  ): Promise<{ kept: number; discarded: number }> {
    const pending = this.manager.getScreenshotsNeedingDecision(taskId);

    if (pending.length === 0) {
      return { kept: 0, discarded: 0 };
    }

    // Show UI for decision
    if (this.ui) {
      const toKeep = await this.ui.askToKeep(pending);

      let kept = 0;
      let discarded = 0;

      for (const screenshot of pending) {
        if (toKeep.includes(screenshot.id)) {
          await this.manager.keepScreenshot(screenshot.id);
          kept++;
        } else {
          await this.manager.discardScreenshot(screenshot.id);
          discarded++;
        }
      }

      await this.ui.showSummary(this.manager.getStats());

      return { kept, discarded };
    }

    // Default: keep all if no UI
    for (const screenshot of pending) {
      await this.manager.keepScreenshot(screenshot.id);
    }

    return { kept: pending.length, discarded: 0 };
  }
}
