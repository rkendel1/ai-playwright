import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ActionCache,
  createCacheKey,
  shouldUseCachedResult,
  mapCachedActionToCurrentObservation,
} from "../action-cache.js";
import type { CachedTaskResult, CachedStep } from "../action-cache.js";
import type { Observation } from "../observer.js";

describe("Action Cache", () => {
  let cache: ActionCache;
  const mockObservation: Observation = {
    id: "obs-1",
    generation: 1,
    url: "https://example.com",
    title: "Example",
    elements: [
      {
        id: "e1",
        role: "searchbox",
        name: "Search",
        state: { visible: true, enabled: true },
      },
      {
        id: "e2",
        role: "button",
        name: "Submit",
        state: { visible: true, enabled: true },
      },
    ],
  };

  const mockCachedResult: CachedTaskResult = {
    taskId: "task-1",
    goal: "Search for items",
    url: "https://example.com",
    steps: [
      {
        observation: mockObservation,
        action: {
          type: "fill",
          locator: { type: "id", elementId: "e1" },
          value: "test query",
        },
        executionTimeMs: 100,
        succeeded: true,
      } as CachedStep,
      {
        observation: mockObservation,
        action: {
          type: "click",
          locator: { type: "id", elementId: "e2" },
        },
        executionTimeMs: 50,
        succeeded: true,
      } as CachedStep,
    ],
    result: "success",
    completedAt: Date.now(),
    durationMs: 150,
    confidence: 0.95,
  };

  beforeEach(() => {
    cache = new ActionCache();
    cache.clear();
  });

  afterEach(() => {
    cache.clear();
  });

  describe("cache key generation", () => {
    it("should create unique keys", () => {
      const key1 = createCacheKey("task-1", "https://example.com");
      const key2 = createCacheKey("task-1", "https://other.com");
      const key3 = createCacheKey("task-2", "https://example.com");

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it("should create same key for same inputs", () => {
      const key1 = createCacheKey("task-1", "https://example.com");
      const key2 = createCacheKey("task-1", "https://example.com");
      expect(key1).toBe(key2);
    });
  });

  describe("cache storage", () => {
    it("should cache results", () => {
      const key = createCacheKey("task-1", "https://example.com");
      cache.cacheResult(key, mockCachedResult);

      const result = cache.getResult(key);
      expect(result).not.toBeNull();
      expect(result?.taskId).toBe("task-1");
    });

    it("should return null for non-existent keys", () => {
      const key = createCacheKey("task-999", "https://nonexistent.com");
      const result = cache.getResult(key);
      expect(result).toBeNull();
    });

    it("should identify successful cached results", () => {
      const key = createCacheKey("task-1", "https://example.com");
      cache.cacheResult(key, mockCachedResult);

      const hasResult = cache.hasSuccessfulResult(key);
      expect(hasResult).toBe(true);
    });

    it("should not use low-confidence results", () => {
      const key = createCacheKey("task-1", "https://example.com");
      const lowConfidenceResult = { ...mockCachedResult, confidence: 0.5 };
      cache.cacheResult(key, lowConfidenceResult);

      const hasResult = cache.hasSuccessfulResult(key);
      expect(hasResult).toBe(false);
    });

    it("should not use failed results", () => {
      const key = createCacheKey("task-1", "https://example.com");
      const failedResult = { ...mockCachedResult, result: "failure" as const };
      cache.cacheResult(key, failedResult);

      const hasResult = cache.hasSuccessfulResult(key);
      expect(hasResult).toBe(false);
    });
  });

  describe("step retrieval", () => {
    it("should get successful steps", () => {
      const key = createCacheKey("task-1", "https://example.com");
      cache.cacheResult(key, mockCachedResult);

      const steps = cache.getSuccessfulSteps(key);
      expect(steps).not.toBeNull();
      expect(steps?.length).toBe(2);
      expect(steps?.every((s) => s.succeeded)).toBe(true);
    });

    it("should return null for non-existent tasks", () => {
      const key = createCacheKey("task-999", "https://nonexistent.com");
      const steps = cache.getSuccessfulSteps(key);
      expect(steps).toBeNull();
    });

    it("should return null for failed tasks", () => {
      const key = createCacheKey("task-1", "https://example.com");
      const failedResult = { ...mockCachedResult, result: "failure" as const };
      cache.cacheResult(key, failedResult);

      const steps = cache.getSuccessfulSteps(key);
      expect(steps).toBeNull();
    });
  });

  describe("utility functions", () => {
    it("shouldUseCachedResult should return true for successful results", () => {
      const key = createCacheKey("task-1", "https://example.com");
      cache.cacheResult(key, mockCachedResult);

      const should = shouldUseCachedResult(key, cache);
      expect(should).toBe(true);
    });

    it("shouldUseCachedResult should return false for non-existent results", () => {
      const key = createCacheKey("task-999", "https://nonexistent.com");
      const should = shouldUseCachedResult(key, cache);
      expect(should).toBe(false);
    });
  });

  describe("action mapping across observations", () => {
    it("should map cached actions to new observations", () => {
      const prevObs: Observation = {
        ...mockObservation,
        id: "obs-1",
      };

      const currentObs: Observation = {
        ...mockObservation,
        id: "obs-2",
        elements: [
          {
            id: "e10",
            role: "searchbox",
            name: "Search",
            state: { visible: true, enabled: true },
          },
          {
            id: "e11",
            role: "button",
            name: "Submit",
            state: { visible: true, enabled: true },
          },
        ],
      };

      const action = {
        type: "fill" as const,
        locator: {
          type: "observation" as const,
          observationId: "obs-1",
          elementId: "e1",
        },
        value: "test",
      };

      const mapped = mapCachedActionToCurrentObservation(
        action as any,
        prevObs,
        currentObs
      );
      expect(mapped).not.toBeNull();
      expect((mapped as any).locator.observationId).toBe("obs-2");
      expect((mapped as any).locator.elementId).toBe("e10");
    });

    it("should return null if element mapping fails", () => {
      const prevObs: Observation = {
        ...mockObservation,
        id: "obs-1",
      };

      const currentObs: Observation = {
        ...mockObservation,
        id: "obs-2",
        elements: [],
      };

      const action = {
        type: "fill" as const,
        locator: {
          type: "observation" as const,
          observationId: "obs-1",
          elementId: "e1",
        },
        value: "test",
      };

      const mapped = mapCachedActionToCurrentObservation(
        action as any,
        prevObs,
        currentObs
      );
      expect(mapped).toBeNull();
    });

    it("should preserve non-locator actions", () => {
      const prevObs = mockObservation;
      const currentObs = mockObservation;

      const action = {
        type: "goto" as const,
        url: "https://other.com",
      };

      const mapped = mapCachedActionToCurrentObservation(
        action as any,
        prevObs,
        currentObs
      );
      expect(mapped).toEqual(action);
    });
  });

  describe("data management", () => {
    it("should clear all cached results", () => {
      const key1 = createCacheKey("task-1", "https://example.com");
      const key2 = createCacheKey("task-2", "https://example.com");

      cache.cacheResult(key1, mockCachedResult);
      cache.cacheResult(key2, mockCachedResult);

      expect(cache.getResult(key1)).not.toBeNull();
      expect(cache.getResult(key2)).not.toBeNull();

      cache.clear();

      expect(cache.getResult(key1)).toBeNull();
      expect(cache.getResult(key2)).toBeNull();
    });

    it("should return all cached results", () => {
      const key1 = createCacheKey("task-1", "https://example.com");
      const key2 = createCacheKey("task-2", "https://example.com");

      cache.cacheResult(key1, mockCachedResult);
      cache.cacheResult(key2, {
        ...mockCachedResult,
        taskId: "task-2",
      });

      const all = cache.getAllResults();
      expect(all.length).toBe(2);
    });

    it("should return only successful cached results", () => {
      const key1 = createCacheKey("task-1", "https://example.com");
      const key2 = createCacheKey("task-2", "https://example.com");

      cache.cacheResult(key1, mockCachedResult);
      cache.cacheResult(key2, {
        ...mockCachedResult,
        taskId: "task-2",
        result: "failure" as const,
      });

      const successful = cache.getSuccessfulResults();
      expect(successful.length).toBe(1);
      expect(successful[0].taskId).toBe("task-1");
    });
  });

  describe("storage persistence", () => {
    it("should load from localStorage if available", () => {
      // Mock localStorage
      const stored: Record<string, CachedTaskResult> = {};
      const mockStorage = {
        getItem: (key: string) => {
          if (key === "runora:action-cache") {
            return JSON.stringify(stored);
          }
          return null;
        },
        setItem: (key: string, value: string) => {
          if (key === "runora:action-cache") {
            Object.assign(stored, JSON.parse(value));
          }
        },
        removeItem: (key: string) => {
          if (key === "runora:action-cache") {
            for (const k in stored) {
              delete stored[k];
            }
          }
        },
      };

      vi.stubGlobal("localStorage", mockStorage);

      const key = createCacheKey("task-1", "https://example.com");
      const cache1 = new ActionCache();
      cache1.cacheResult(key, mockCachedResult);

      const cache2 = new ActionCache();
      const result = cache2.getResult(key);
      expect(result).not.toBeNull();

      vi.unstubAllGlobals();
    });
  });
});
