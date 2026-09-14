import type { Observation, ElementObservation } from "./observer.js";

export type OptimizationStrategy = "aggressive" | "balanced" | "minimal";

export type OptimizedObservation = Observation & {
  originalTokenEstimate?: number;
  optimizedTokenEstimate?: number;
  reductionPercent?: number;
  strategy: OptimizationStrategy;
  truncationNotes?: string[];
};

export class ObservationOptimizer {
  private tokenMultiplier = 0.25; // Rough estimate: four characters per token

  constructor(private strategy: OptimizationStrategy = "balanced") {}

  optimize(observation: Observation): OptimizedObservation {
    const originalTokens = this.estimateTokens(JSON.stringify(observation));

    let optimized = JSON.parse(JSON.stringify(observation)) as Observation;
    const notes: string[] = [];

    switch (this.strategy) {
      case "aggressive":
        optimized = this.aggressiveOptimization(optimized, notes);
        break;
      case "balanced":
        optimized = this.balancedOptimization(optimized, notes);
        break;
      case "minimal":
        optimized = this.minimalOptimization(optimized, notes);
        break;
    }

    const optimizedTokens = this.estimateTokens(JSON.stringify(optimized));
    const reduction = Math.round(
      ((originalTokens - optimizedTokens) / originalTokens) * 100
    );

    return {
      ...optimized,
      originalTokenEstimate: originalTokens,
      optimizedTokenEstimate: optimizedTokens,
      reductionPercent: reduction,
      strategy: this.strategy,
      truncationNotes: notes.length > 0 ? notes : undefined,
    };
  }

  private aggressiveOptimization(
    obs: Observation,
    notes: string[]
  ): Observation {
    // Keep only critical elements
    const criticalRoles = [
      "textbox",
      "searchbox",
      "button",
      "combobox",
      "link",
    ];
    const originalCount = obs.elements.length;

    obs.elements = obs.elements
      .filter((e) => criticalRoles.includes(e.role ?? ""))
      .slice(0, Math.max(1, Math.floor(originalCount * 0.4)));

    if (obs.elements.length < originalCount) {
      notes.push(
        `Filtered elements from ${originalCount} to ${obs.elements.length} (kept: ${criticalRoles.join(", ")})`
      );
    }

    // Truncate page text severely
    if (obs.text) {
      const truncated = obs.text.slice(0, 300);
      if (truncated.length < obs.text.length) {
        obs.text = truncated + "...";
        notes.push(`Page text truncated to 300 chars`);
      }
    }

    // Remove non-critical fields
    obs.elements.forEach((e) => {
      delete e.bounds;
      delete e.ariaLabel;
    });

    return obs;
  }

  private balancedOptimization(
    obs: Observation,
    notes: string[]
  ): Observation {
    const originalCount = obs.elements.length;

    // Keep interactive elements
    obs.elements = obs.elements.filter(
      (e) =>
        e.state.enabled &&
        e.state.visible &&
        ![
          "presentation",
          "none",
          "generic",
          "group",
        ].includes(e.role ?? "")
    );

    if (obs.elements.length < originalCount) {
      notes.push(
        `Filtered to ${obs.elements.length} interactive elements (from ${originalCount})`
      );
    }

    // Truncate long page text
    if (obs.text && obs.text.length > 1000) {
      obs.text = obs.text.slice(0, 1000) + "...";
      notes.push(`Page text truncated to 1000 chars`);
    }

    // Shorten element names if too long
    obs.elements.forEach((e) => {
      delete e.bounds;
      if (e.name && e.name.length > 100) {
        e.name = e.name.slice(0, 100) + "...";
      }
    });

    return obs;
  }

  private minimalOptimization(
    obs: Observation,
    notes: string[]
  ): Observation {
    const originalCount = obs.elements.length;

    // Keep all visible, enabled elements (light filtering)
    obs.elements = obs.elements.filter(
      (e) => e.state.enabled && e.state.visible
    );

    if (obs.elements.length < originalCount) {
      notes.push(
        `Filtered to ${obs.elements.length} visible/enabled elements`
      );
    }

    // Keep full page text but cap at reasonable size
    if (obs.text && obs.text.length > 2000) {
      obs.text = obs.text.slice(0, 2000) + "...";
      notes.push(`Page text truncated to 2000 chars`);
    }

    return obs;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length * this.tokenMultiplier);
  }

  getRecommendedStrategy(observation: Observation): OptimizationStrategy {
    const tokens = this.estimateTokens(JSON.stringify(observation));

    if (tokens < 2000) return "minimal";
    if (tokens < 3500) return "balanced";
    return "aggressive";
  }
}

export class ContextAwareObserver {
  private optimizer: ObservationOptimizer;

  constructor(private contextWindowSize: number = 4096) {
    this.optimizer = new ObservationOptimizer("balanced");
  }

  optimizeForContextWindow(
    observation: Observation,
    reserveTokens: number = 512
  ): OptimizedObservation {
    const availableTokens = this.contextWindowSize - reserveTokens;

    let optimized = this.optimizer.optimize(observation);
    let strategy: OptimizationStrategy = "minimal";

    while (
      (optimized.optimizedTokenEstimate ?? 0) > availableTokens &&
      strategy !== "aggressive"
    ) {
      strategy = this.getNextAggressive(strategy);
      this.optimizer = new ObservationOptimizer(strategy);
      optimized = this.optimizer.optimize(observation);
    }

    return optimized;
  }

  private getNextAggressive(current: OptimizationStrategy): OptimizationStrategy {
    if (current === "minimal") return "balanced";
    if (current === "balanced") return "aggressive";
    return "aggressive";
  }
}

export function summarizeObservation(
  observation: Observation,
  maxTokens: number = 1000
): string {
  const interactiveElements = observation.elements.filter(
    (e) => e.state.enabled && e.state.visible
  );

  const summary = {
    url: observation.url,
    title: observation.title,
    elementCount: interactiveElements.length,
    elements: interactiveElements.slice(0, 10).map((e) => ({
      role: e.role,
      name: e.name?.slice(0, 50),
      type: e.inputType,
    })),
    pageText: observation.text?.slice(0, 200),
  };

  return JSON.stringify(summary);
}

export const optimizationStrategies = {
  captchaDetection: (obs: Observation): boolean => {
    const captchaKeywords = [
      "captcha",
      "robot",
      "verify",
      "unusual traffic",
      "challenge",
    ];
    const text = (obs.text || "").toLowerCase();
    return captchaKeywords.some((keyword) => text.includes(keyword));
  },

  isRateLimited: (obs: Observation): boolean => {
    const rateLimitKeywords = [
      "too many",
      "rate limit",
      "throttle",
      "try again",
      "temporarily",
      "unavailable",
    ];
    const text = (obs.text || "").toLowerCase();
    return rateLimitKeywords.some((keyword) => text.includes(keyword));
  },

  isErrorPage: (obs: Observation): boolean => {
    const errorKeywords = [
      "error",
      "404",
      "500",
      "something went wrong",
      "page not found",
    ];
    const text = (obs.text || "").toLowerCase();
    const title = (obs.title || "").toLowerCase();
    return (
      errorKeywords.some((keyword) => text.includes(keyword)) ||
      errorKeywords.some((keyword) => title.includes(keyword))
    );
  },

  detectPageState: (
    obs: Observation
  ): "normal" | "error" | "captcha" | "rate-limited" => {
    if (optimizationStrategies.captchaDetection(obs)) return "captcha";
    if (optimizationStrategies.isRateLimited(obs)) return "rate-limited";
    if (optimizationStrategies.isErrorPage(obs)) return "error";
    return "normal";
  },
};
