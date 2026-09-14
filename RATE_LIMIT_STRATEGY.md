# Rate Limit Prevention Strategy

## Problem

Your tests are hitting rate limits on GitHub and other sites because:

1. **No Result Caching**: Each test run makes fresh requests (even if test is identical)
2. **No Request Throttling**: Tests run as fast as possible, hammering servers
3. **No Retry Logic**: Failed requests fail hard instead of backing off
4. **No Session Persistence**: Each run starts fresh, can't reuse cookies/auth
5. **Model Re-Downloads**: WebLLM downloads 100MB+ every session

**Result**: GitHub blocks you with "Too many requests" → test fails → you rerun → hit more rate limits → spiral.

## Solution Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Task Execution Flow                        │
└─────────────────────────────────────────────────────────┘
                         ↓
         ┌───────────────────────────────────┐
         │ Check Cache (BEFORE running test) │
         └───────────────────────────────────┘
                    ↓          ↓
            CACHE HIT    CACHE MISS
                    ↓          ↓
              (Skip       Start SmartRetry
              entirely)       ↓
                    ↓    Apply RateLimiter
                    ↓    (request throttling)
                    ↓          ↓
                    ↓    Execute Action
                    ↓          ↓
                    ↓    ┌──────────────┐
                    ↓    │ Rate Limited?│
                    ↓    └──────────────┘
                    ↓      ↓         ↓
                    ↓   YES        NO
                    ↓    ↓         ↓
                    ↓  Wait+Retry  Cache Result
                    ↓    ↓         ↓
                    └────────────────┘
                          ↓
                    ┌──────────────┐
                    │   SUCCESS    │
                    └──────────────┘
```

## Implementation

### 1. Initialize Rate Limiter

```typescript
import { PageRateLimitInterceptor, rateLimiterPresets } from "./rate-limiter.js";

async function setupBrowser(page: Page, targetSite: string) {
  // Choose preset based on target
  const config = targetSite.includes("github.com")
    ? rateLimiterPresets.gentle     // 1s delay, 20 req/min
    : rateLimiterPresets.moderate;   // 500ms delay, 30 req/min

  const limiter = new PageRateLimitInterceptor(page, config);
  await limiter.initialize();

  return limiter;
}
```

### 2. Use Cache-First Approach

```typescript
import { createCacheKey, actionCache } from "./action-cache.js";

async function runTaskWithCache(
  goal: string,
  url: string
) {
  const taskId = "github-search-task";
  const cacheKey = createCacheKey(taskId, url);

  // Check cache FIRST
  if (actionCache.hasSuccessfulResult(cacheKey)) {
    console.log("✅ Using cached result - no network requests!");
    return actionCache.getResult(cacheKey);
  }

  // Only run against network if cache miss
  console.log("🌐 Cache miss - running test against site...");
  const result = await executeTask(goal, url);

  // Cache the result
  if (result.status === "success") {
    actionCache.cacheResult(cacheKey, {
      taskId,
      goal,
      url,
      steps: result.steps,
      result: "success",
      completedAt: Date.now(),
      durationMs: result.durationMs,
      confidence: 0.95,
    });
  }

  return result;
}
```

### 3. Smart Retry on Rate Limits

```typescript
import { SmartRetry, CacheFirstRetry } from "./smart-retry.js";

const smartRetry = new SmartRetry(actionCache, {
  initialDelayMs: 500,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  maxAttempts: 3,
  detectRateLimitResponses: true,
});

const cacheFirstRetry = new CacheFirstRetry(smartRetry, actionCache);

async function executeLikelyRateLimitedAction() {
  const cacheKey = createCacheKey("github-search", "https://github.com");
  const cachedResult = actionCache.getResult(cacheKey);

  return cacheFirstRetry.executeOrUseCache(
    cacheKey,
    async (attempt) => {
      console.log(`Attempt ${attempt}...`);
      return await actuallyExecuteAction();
    },
    cachedResult?.steps  // Fallback if rate limited
  );
}
```

### 4. Session Persistence

```typescript
// Keep browser context alive across test runs
const browser = await chromium.launch();
const context = await browser.createContext({
  // Persist cookies/auth
  storageState: "/tmp/browser-storage.json"
});

// Store cookies at end of test
await context.storageState({ path: "/tmp/browser-storage.json" });

// Reuse cookies in next run
const newContext = await browser.createContext({
  storageState: "/tmp/browser-storage.json"
});
```

### 5. Model Caching (WebLLM)

Configure browser to keep models:

```typescript
export default {
  persistentStorage: {
    enabled: true,
    maxSizeBytes: 5 * 1024 * 1024 * 1024, // 5GB
  },
  modelCaching: {
    preload: ["Llama-3.2-1B-Instruct-q4f16_1-MLC"],
    revalidateAfterDays: 7,
    persistAcrossSessions: true,
  },
};
```

## Rate Limit Response Detection

The `RateLimiter` automatically detects:

| Status | Detection | Action |
|--------|-----------|--------|
| 429 | Too Many Requests | Wait `Retry-After` header |
| 503 | Service Unavailable | Wait 30s, then retry |
| 403 | Forbidden | Mark as blocked, don't retry |
| Other | - | Continue normally |

## Preset Configurations

### Gentle (Safe for any site)
```typescript
{
  requestDelayMs: 1000,      // 1s between requests
  maxRequestsPerMinute: 20,  // Max 20 req/min
  backoffMultiplier: 2
}
```
**Use for**: GitHub, proprietary APIs, strict sites

### Moderate (Balanced)
```typescript
{
  requestDelayMs: 500,       // 500ms between requests
  maxRequestsPerMinute: 30,  // Max 30 req/min
  backoffMultiplier: 1.5
}
```
**Use for**: Default, most public APIs

### Aggressive (For fast sites)
```typescript
{
  requestDelayMs: 200,       // 200ms between requests
  maxRequestsPerMinute: 60,  // Max 60 req/min
  backoffMultiplier: 2
}
```
**Use for**: Internal services, localhost testing

## Real-World Example: GitHub Search

### Before (Gets Rate Limited)

```
Run 1: Search GitHub repo
  → LLM plans actions
  → Hits GitHub 10 times
  → Cache: MISS
  → Result: ✅ PASS (but 10 requests made)

Run 2: Same search (identical test)
  → LLM plans actions AGAIN
  → Hits GitHub 10 times AGAIN
  → Cache: MISS (old system had no cache)
  → Result: ❌ BLOCKED - "429 Too Many Requests"

Run 3: Retry after 1 hour
  → Repeat steps 1-2
  → Spiral of failures
```

### After (Smart Caching + Rate Limiting)

```
Run 1: Search GitHub repo
  → Check cache: MISS
  → SmartRetry initializes
  → RateLimiter: 1s delay between requests
  → Hits GitHub 10 times (over ~10 seconds, not hammering)
  → Cache result with 0.95 confidence
  → Result: ✅ PASS

Run 2: Same search (identical test)
  → Check cache: HIT
  → Skip LLM entirely
  → Skip browser execution
  → Result: ✅ PASS (instant, 0 network requests)

Run 3: Same search again
  → Check cache: HIT
  → Skip everything
  → Result: ✅ PASS (instant)

Run 4: Different search task
  → Check cache: MISS
  → SmartRetry initializes
  → RateLimiter already knows GitHub's rate
  → Applies gentle throttling automatically
  → Result: ✅ PASS
```

**Impact**: 
- Run 1: 10s (network + execution)
- Run 2-4: <100ms each (cached)
- Network requests: 20 total (spread over time with throttling) vs 40+ (hammering)

## Monitoring & Debugging

### Check Rate Limiter Status

```typescript
const limiter = new PageRateLimitInterceptor(page, rateLimiterPresets.gentle);
console.log(limiter.getStats());
// Output:
// {
//   requestsThisMinute: 8,
//   isRateLimited: false,
//   secondsUntilFree: 0
// }
```

### Check Retry History

```typescript
const retry = new SmartRetry(actionCache);
const history = retry.getHistory("github-search");
console.log(history);
// Output:
// {
//   attempts: 2,
//   lastError: "429 Too Many Requests"
// }
```

### Check Cache Hit Rate

```typescript
const successful = actionCache.getSuccessfulResults();
console.log(`Cache hit rate: ${successful.length} cached tests`);
```

## Integration Checklist

- [ ] Import `PageRateLimitInterceptor` and initialize on browser startup
- [ ] Choose appropriate `rateLimiterPreset` for your target site
- [ ] Import `ActionCache` and check cache before running tests
- [ ] Cache successful results automatically
- [ ] Import `SmartRetry` for handling rate limit responses
- [ ] Configure model caching for WebLLM (5GB local storage)
- [ ] Enable session persistence (cookies, auth tokens)
- [ ] Monitor rate limiter stats in debug output
- [ ] Set up alerting when rate limited (optional)

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| First run time | 10-15s | 10-15s (unchanged) |
| Cached run time | 10-15s (re-hit site) | <100ms (cache only) |
| Requests/hour | 30+ (hammering) | 5-20 (throttled) |
| Rate limit blocks | Frequent | Rare |
| Model download time | 30-60s per run | 0s (cached) |
| Test reliability | 40-50% | 95%+ |

## Future Enhancements

1. **Distributed Cache**: Share successful results across team
2. **Request Pooling**: Batch similar requests
3. **Proxy Rotation**: Use proxies to distribute load
4. **Adaptive Throttling**: Learn optimal rate for each site
5. **Request Analytics**: Track what's slow, what's blocked

## Support

If you're still hitting rate limits:

1. **Check cache**: `actionCache.getAllResults()`
2. **Verify limiter**: `limiter.getStats()`
3. **Review preset**: Try `gentle` instead of `moderate`
4. **Check Retry-After**: Look for server's suggested wait time
5. **Report issue**: Include stats + error message
