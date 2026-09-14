import type { Page } from "playwright";

export type RateLimitConfig = {
  requestDelayMs?: number;
  maxRequestsPerMinute?: number;
  backoffMultiplier?: number;
  maxRetries?: number;
  detectRateLimitPatterns?: boolean;
};

export type RateLimitDetection = {
  isRateLimited: boolean;
  statusCode?: number;
  retryAfterSeconds?: number;
  reason?: string;
};

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private isCurrentlyRateLimited = false;
  private rateLimitUntil = 0;
  private retryDelay = 1000;

  constructor(private config: RateLimitConfig = {}) {
    this.config = {
      requestDelayMs: 500,
      maxRequestsPerMinute: 30,
      backoffMultiplier: 2,
      maxRetries: 3,
      detectRateLimitPatterns: true,
      ...config,
    };
  }

  async waitBeforeRequest(): Promise<void> {
    const now = Date.now();

    if (this.isCurrentlyRateLimited && now < this.rateLimitUntil) {
      const waitTime = this.rateLimitUntil - now;
      console.warn(
        `[RateLimiter] Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s`
      );
      await this.sleep(waitTime);
      this.isCurrentlyRateLimited = false;
    }

    await this.enforceRequestDelay();
    this.recordRequest();
  }

  detectRateLimit(
    statusCode: number,
    headers?: Record<string, string>
  ): RateLimitDetection {
    if (!this.config.detectRateLimitPatterns) {
      return { isRateLimited: false };
    }

    if (statusCode === 429) {
      const retryAfter = headers?.["retry-after"];
      const retrySeconds = retryAfter ? parseInt(retryAfter) : 60;

      this.handleRateLimit(retrySeconds);
      return {
        isRateLimited: true,
        statusCode: 429,
        retryAfterSeconds: retrySeconds,
        reason: "HTTP 429 Too Many Requests",
      };
    }

    if (statusCode === 503) {
      this.handleRateLimit(30);
      return {
        isRateLimited: true,
        statusCode: 503,
        retryAfterSeconds: 30,
        reason: "HTTP 503 Service Unavailable",
      };
    }

    if (statusCode === 403) {
      return {
        isRateLimited: true,
        statusCode: 403,
        reason: "HTTP 403 Forbidden (possible IP block)",
      };
    }

    return { isRateLimited: false };
  }

  private handleRateLimit(secondsToWait: number): void {
    this.isCurrentlyRateLimited = true;
    this.rateLimitUntil = Date.now() + secondsToWait * 1000;
    this.retryDelay = Math.min(
      this.retryDelay * (this.config.backoffMultiplier ?? 2),
      60000
    );
  }

  private enforceRequestDelay(): Promise<void> {
    const delay = this.config.requestDelayMs ?? 500;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private recordRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);

    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => t > oneMinuteAgo
    );

    const maxRequests = this.config.maxRequestsPerMinute ?? 30;
    if (this.requestTimestamps.length > maxRequests) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = 60000 - (now - oldestRequest);
      console.warn(
        `[RateLimiter] Exceeded ${maxRequests} requests/minute. Waiting ${Math.ceil(waitTime / 1000)}s`
      );
      this.rateLimitUntil = now + waitTime;
    }
  }

  getStats(): {
    requestsThisMinute: number;
    isRateLimited: boolean;
    secondsUntilFree: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestTimestamps.filter((t) => t > oneMinuteAgo);

    return {
      requestsThisMinute: recentRequests.length,
      isRateLimited: this.isCurrentlyRateLimited && now < this.rateLimitUntil,
      secondsUntilFree: Math.ceil(
        Math.max(0, this.rateLimitUntil - now) / 1000
      ),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reset(): void {
    this.requestTimestamps = [];
    this.isCurrentlyRateLimited = false;
    this.rateLimitUntil = 0;
    this.retryDelay = 1000;
  }
}

export class PageRateLimitInterceptor {
  private rateLimiter: RateLimiter;

  constructor(
    private page: Page,
    config?: RateLimitConfig
  ) {
    this.rateLimiter = new RateLimiter(config);
  }

  async initialize(): Promise<void> {
    await this.page.route("**/*", async (route, request) => {
      await this.rateLimiter.waitBeforeRequest();
      try {
        const response = await route.continue();
        const detection = this.rateLimiter.detectRateLimit(
          response.status(),
          this.parseHeaders(response.headers())
        );

        if (detection.isRateLimited) {
          console.warn(
            `[RateLimiter] Detected: ${detection.reason}`,
            this.rateLimiter.getStats()
          );

          if (response.status() === 429 || response.status() === 503) {
            const retrySeconds = detection.retryAfterSeconds ?? 60;
            console.warn(
              `[RateLimiter] Waiting ${retrySeconds}s before retry...`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, retrySeconds * 1000)
            );
            return route.continue();
          }
        }
        return response;
      } catch (error) {
        console.error("[RateLimiter] Interception error:", error);
        return route.continue();
      }
    });
  }

  private parseHeaders(headers: Record<string, string>): Record<string, string> {
    return headers;
  }

  getStats() {
    return this.rateLimiter.getStats();
  }

  reset() {
    this.rateLimiter.reset();
  }
}

export const rateLimiterPresets = {
  gentle: {
    requestDelayMs: 1000,
    maxRequestsPerMinute: 20,
    backoffMultiplier: 2,
  },
  moderate: {
    requestDelayMs: 500,
    maxRequestsPerMinute: 30,
    backoffMultiplier: 1.5,
  },
  aggressive: {
    requestDelayMs: 200,
    maxRequestsPerMinute: 60,
    backoffMultiplier: 2,
  },
};
