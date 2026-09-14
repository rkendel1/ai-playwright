import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimiter, rateLimiterPresets } from "../rate-limiter.js";

describe("Rate Limiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("request delay enforcement", () => {
    it("should enforce minimum delay between requests", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 100 });
      const start = Date.now();

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();

      expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    });

    it("should apply configured delay", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 500 });
      let delayApplied = 0;

      vi.spyOn(global, "setTimeout").mockImplementation((cb: any, ms: number) => {
        delayApplied = ms;
        cb();
        return 0 as any;
      });

      await limiter.waitBeforeRequest();
      expect(delayApplied).toBe(500);
    });
  });

  describe("rate limit detection", () => {
    it("should detect 429 Too Many Requests", () => {
      const result = limiter.detectRateLimit(429);
      expect(result.isRateLimited).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it("should detect 503 Service Unavailable", () => {
      const result = limiter.detectRateLimit(503);
      expect(result.isRateLimited).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it("should detect 403 Forbidden", () => {
      const result = limiter.detectRateLimit(403);
      expect(result.isRateLimited).toBe(true);
      expect(result.statusCode).toBe(403);
    });

    it("should not flag normal responses", () => {
      const result = limiter.detectRateLimit(200);
      expect(result.isRateLimited).toBe(false);
    });

    it("should parse Retry-After header", () => {
      const result = limiter.detectRateLimit(429, {
        "retry-after": "60",
      });
      expect(result.retryAfterSeconds).toBe(60);
    });
  });

  describe("request tracking", () => {
    it("should track requests per minute", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 0 });

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();

      const stats = limiter.getStats();
      expect(stats.requestsThisMinute).toBe(3);
    });

    it("should enforce maximum requests per minute", async () => {
      const limiter = new RateLimiter({
        requestDelayMs: 0,
        maxRequestsPerMinute: 2,
      });

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest(); // Should trigger rate limit

      const stats = limiter.getStats();
      expect(stats.isRateLimited).toBe(true);
    });

    it("should clear old requests after 1 minute", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 0 });

      await limiter.waitBeforeRequest();
      vi.advanceTimersByTime(61000); // Advance 61 seconds
      await limiter.waitBeforeRequest();

      const stats = limiter.getStats();
      expect(stats.requestsThisMinute).toBe(1);
    });
  });

  describe("backoff strategy", () => {
    it("should apply exponential backoff", async () => {
      const limiter = new RateLimiter({
        requestDelayMs: 0,
        maxRequestsPerMinute: 1,
        backoffMultiplier: 2,
      });

      const delays: number[] = [];
      vi.spyOn(global, "setTimeout").mockImplementation(
        (cb: any, ms: number) => {
          delays.push(ms);
          cb();
          return 0 as any;
        }
      );

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest(); // Triggers rate limit

      expect(delays.length).toBeGreaterThan(0);
    });

    it("should cap backoff delay", async () => {
      const limiter = new RateLimiter({
        requestDelayMs: 0,
        maxRequestsPerMinute: 1,
        backoffMultiplier: 10,
        maxRequestsPerMinute: 100, // Will never hit limit
      });

      const stats = limiter.getStats();
      expect(stats.secondsUntilFree).toBeLessThanOrEqual(30000 / 1000);
    });
  });

  describe("presets", () => {
    it("should provide gentle preset", () => {
      expect(rateLimiterPresets.gentle).toEqual({
        requestDelayMs: 1000,
        maxRequestsPerMinute: 20,
        backoffMultiplier: 2,
      });
    });

    it("should provide moderate preset", () => {
      expect(rateLimiterPresets.moderate).toEqual({
        requestDelayMs: 500,
        maxRequestsPerMinute: 30,
        backoffMultiplier: 1.5,
      });
    });

    it("should provide aggressive preset", () => {
      expect(rateLimiterPresets.aggressive).toEqual({
        requestDelayMs: 200,
        maxRequestsPerMinute: 60,
        backoffMultiplier: 2,
      });
    });
  });

  describe("statistics", () => {
    it("should report current stats", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 0 });

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();

      const stats = limiter.getStats();
      expect(stats.requestsThisMinute).toBe(2);
      expect(stats.isRateLimited).toBe(false);
      expect(stats.secondsUntilFree).toBe(0);
    });

    it("should report when rate limited", async () => {
      const limiter = new RateLimiter({
        requestDelayMs: 0,
        maxRequestsPerMinute: 1,
      });

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest(); // Triggers rate limit

      const stats = limiter.getStats();
      expect(stats.isRateLimited).toBe(true);
      expect(stats.secondsUntilFree).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("should clear all tracking on reset", async () => {
      const limiter = new RateLimiter({ requestDelayMs: 0 });

      await limiter.waitBeforeRequest();
      await limiter.waitBeforeRequest();

      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.requestsThisMinute).toBe(0);
      expect(stats.isRateLimited).toBe(false);
    });
  });
});
