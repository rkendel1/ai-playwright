import type { BrowserAction } from "./action-schema.js";
import type { Observation } from "./observer.js";

export type CachedStep = {
  observation: Observation;
  action: BrowserAction;
  executionTimeMs: number;
  succeeded: boolean;
  errorMessage?: string;
};

export type CachedTaskResult = {
  taskId: string;
  goal: string;
  url: string;
  steps: CachedStep[];
  result: "success" | "failure" | "blocked";
  completedAt: number;
  durationMs: number;
  modelUsed?: string;
  confidence: number;
};

export type CacheKey = string & { readonly __brand: "CacheKey" };

export function createCacheKey(taskId: string, url: string): CacheKey {
  return `task:${taskId}:url:${url}` as CacheKey;
}

export class ActionCache {
  private cache: Map<CacheKey, CachedTaskResult> = new Map();
  private storageKey = "runora:action-cache";

  constructor() {
    this.loadFromStorage();
  }

  cacheResult(key: CacheKey, result: CachedTaskResult): void {
    this.cache.set(key, result);
    this.saveToStorage();
  }

  getResult(key: CacheKey): CachedTaskResult | null {
    return this.cache.get(key) ?? null;
  }

  hasSuccessfulResult(key: CacheKey): boolean {
    const result = this.cache.get(key);
    return result?.result === "success" && result.confidence > 0.8;
  }

  getSuccessfulSteps(key: CacheKey): CachedStep[] | null {
    const result = this.cache.get(key);
    if (result?.result !== "success") return null;
    return result.steps.filter((step) => step.succeeded);
  }

  private loadFromStorage(): void {
    try {
      if (typeof globalThis.localStorage === "undefined") return;
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;
      const data = JSON.parse(stored) as Record<string, CachedTaskResult>;
      for (const [key, value] of Object.entries(data)) {
        this.cache.set(key as CacheKey, value);
      }
    } catch {
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof globalThis.localStorage === "undefined") return;
      const data: Record<string, CachedTaskResult> = {};
      for (const [key, value] of this.cache) {
        data[key] = value;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
    }
  }

  clear(): void {
    this.cache.clear();
    try {
      if (typeof globalThis.localStorage !== "undefined") {
        localStorage.removeItem(this.storageKey);
      }
    } catch {
    }
  }

  getAllResults(): CachedTaskResult[] {
    return Array.from(this.cache.values());
  }

  getSuccessfulResults(): CachedTaskResult[] {
    return Array.from(this.cache.values()).filter(
      (r) => r.result === "success" && r.confidence > 0.8
    );
  }
}

export const actionCache = new ActionCache();

export function shouldUseCachedResult(
  key: CacheKey,
  cache: ActionCache = actionCache
): boolean {
  return cache.hasSuccessfulResult(key);
}

export function getCachedStepsByObservation(
  steps: CachedStep[],
  currentObservation: Observation
): CachedStep[] {
  return steps.filter((step) => {
    if (!("locator" in step.action)) return true;
    const locator = step.action.locator;
    if (locator.type === "observation") {
      return locator.observationId === currentObservation.id;
    }
    return true;
  });
}

export function mapCachedActionToCurrentObservation(
  action: BrowserAction,
  previousObservation: Observation,
  currentObservation: Observation
): BrowserAction | null {
  if (!("locator" in action)) {
    return action;
  }

  const locator = action.locator;
  if (locator.type === "observation") {
    const prevElement = previousObservation.elements.find(
      (e) => e.id === locator.elementId
    );
    if (!prevElement) return null;

    const currentElement = currentObservation.elements.find(
      (e) =>
        e.role === prevElement.role &&
        e.name === prevElement.name &&
        e.value === prevElement.value
    );

    if (!currentElement) return null;

    return {
      ...action,
      locator: {
        type: "observation",
        observationId: currentObservation.id,
        elementId: currentElement.id,
      },
    };
  }

  return action;
}
