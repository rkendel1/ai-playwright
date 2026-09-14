import type { ActionCache } from "./action-cache.js";
import type { BrowserAction } from "./action-schema.js";
import type { Observation } from "./observer.js";

export type RetryStrategy = {
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxAttempts: number;
  detectRateLimitResponses: boolean;
};

export type RetryResult<T> = {
  success: boolean;
  attempt: number;
  result?: T;
  error?: string;
  lastErrorWasRateLimit?: boolean;
  totalTimeMs: number;
};

export class SmartRetry {
  private retryHistory: Map<string, { attempts: number; lastError: string }> =
    new Map();

  constructor(
    private actionCache: ActionCache,
    private strategy: RetryStrategy = {
      initialDelayMs: 500,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      maxAttempts: 3,
      detectRateLimitResponses: true,
    }
  ) {}

  async executeWithRetry<T>(
    key: string,
    executor: (attempt: number) => Promise<T>,
    shouldRetry?: (error: Error, attempt: number) => boolean
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();

    for (let attempt = 1; attempt <= this.strategy.maxAttempts; attempt++) {
      try {
        const result = await executor(attempt);
        this.retryHistory.delete(key);
        return {
          success: true,
          attempt,
          result,
          totalTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isRateLimit = this.detectRateLimit(err);
        const shouldRetryAgain =
          shouldRetry?.(err, attempt) ?? this.shouldRetryDefault(err, attempt);

        if (!shouldRetryAgain || attempt >= this.strategy.maxAttempts) {
          this.retryHistory.set(key, {
            attempts: attempt,
            lastError: err.message,
          });

          return {
            success: false,
            attempt,
            error: err.message,
            lastErrorWasRateLimit: isRateLimit,
            totalTimeMs: Date.now() - startTime,
          };
        }

        const delayMs = this.calculateBackoff(attempt);
        console.warn(
          `[SmartRetry] Attempt ${attempt} failed: ${err.message}. ` +
            `Retrying in ${delayMs}ms...`
        );

        if (isRateLimit) {
          console.warn(
            "[SmartRetry] Rate limit detected. Checking cache for fallback..."
          );
        }

        await this.sleep(delayMs);
      }
    }

    throw new Error(
      `[SmartRetry] Failed after ${this.strategy.maxAttempts} attempts`
    );
  }

  shouldUseCacheInsteadOfRetry(
    key: string,
    cache: ActionCache
  ): boolean {
    if (!cache.hasSuccessfulResult(key as any)) {
      return false;
    }

    const history = this.retryHistory.get(key);
    if (!history) return false;

    const rateLimit = history.lastError.toLowerCase().includes("rate limit");
    const tooMany = history.lastError
      .toLowerCase()
      .includes("too many requests");
    const blocked = history.lastError.toLowerCase().includes("blocked");

    return rateLimit || tooMany || blocked;
  }

  private detectRateLimit(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("throttle") ||
      msg.includes("503") ||
      msg.includes("service unavailable")
    );
  }

  private shouldRetryDefault(error: Error, attempt: number): boolean {
    if (attempt >= this.strategy.maxAttempts) return false;

    const msg = error.message.toLowerCase();

    const retryable =
      msg.includes("timeout") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("temporarily unavailable");

    const notRetryable =
      msg.includes("404") ||
      msg.includes("not found") ||
      msg.includes("invalid") ||
      msg.includes("authentication") ||
      msg.includes("401") ||
      msg.includes("403");

    if (notRetryable) return false;
    return retryable || this.isNetworkError(error);
  }

  private isNetworkError(error: Error): boolean {
    return (
      error instanceof TypeError ||
      error.message.includes("network") ||
      error.message.includes("fetch") ||
      error.message.includes("connection")
    );
  }

  private calculateBackoff(attempt: number): number {
    const exponentialDelay =
      this.strategy.initialDelayMs *
      Math.pow(this.strategy.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(
      exponentialDelay,
      this.strategy.maxDelayMs
    );
    const jitter = Math.random() * 0.1 * cappedDelay;
    return Math.floor(cappedDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getHistory(key: string): { attempts: number; lastError: string } | null {
    return this.retryHistory.get(key) ?? null;
  }

  clearHistory(key?: string): void {
    if (key) {
      this.retryHistory.delete(key);
    } else {
      this.retryHistory.clear();
    }
  }
}

export class CacheFirstRetry {
  constructor(
    private actionCache: ActionCache,
    private retry: SmartRetry
  ) {}

  async executeOrUseCache<T>(
    key: string,
    executor: (attempt: number) => Promise<T>,
    fallbackCacheValue?: T
  ): Promise<T> {
    try {
      const result = await this.retry.executeWithRetry(key, executor);
      if (result.success && result.result) {
        return result.result;
      }

      if (result.lastErrorWasRateLimit) {
        console.warn(
          "[CacheFirstRetry] Rate limited. Checking cache for previous result..."
        );

        if (fallbackCacheValue) {
          console.warn(
            "[CacheFirstRetry] Using cached fallback instead of failing"
          );
          return fallbackCacheValue;
        }
      }

      throw new Error(result.error ?? "Execution failed");
    } catch (error) {
      if (fallbackCacheValue) {
        console.warn(
          "[CacheFirstRetry] All retries exhausted. Using cached fallback."
        );
        return fallbackCacheValue;
      }
      throw error;
    }
  }
}
