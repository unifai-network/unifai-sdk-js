/**
 * # RateLimiter
 *
 * Zero-dependency, async rate limiter with support for multiple rate limit groups.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { RateLimiter } from './rate-limiter';
 *
 * // Create limiter with global limit (50 req/sec)
 * const limiter = new RateLimiter({
 *   global: {
 *     config: { maxRequests: 50, windowMs: 1000 }
 *   }
 * });
 *
 * // Use before making requests
 * await limiter.waitForLimit('anyEndpoint');
 * ```
 *
 * ## Per-Endpoint Limits
 *
 * ```typescript
 * const limiter = new RateLimiter({
 *   createWallet: {
 *     config: { maxRequests: 10, windowMs: 60000 }, // 10 req/min
 *     endpoints: ['createWallet', 'importWallet']
 *   },
 *   queries: {
 *     config: { maxRequests: 100, windowMs: 1000 }, // 100 req/sec
 *     endpoints: ['getBalance', 'getHistory']
 *   }
 * }, console); // Optional: pass any logger (console, Winston, Pino, etc.)
 *
 * await limiter.waitForLimit('createWallet');
 * ```
 *
 * ## Features
 * - Automatic waiting when limit exceeded
 * - Multiple concurrent groups per endpoint
 * - Global + per-endpoint limits
 * - Optional logger integration
 * - `reset()` for testing
 * - `getStatus()` for debugging
 */

/**
 * Logger interface compatible with various logging libraries
 * Compatible with nestjs-pino, Winston, console, and other loggers
 */
export interface Logger {
  debug(obj: any, msg?: string): void;
  debug(msg: string): void;
  info(obj: any, msg?: string): void;
  info(msg: string): void;
  warn(obj: any, msg?: string): void;
  warn(msg: string): void;
  error(obj: any, msg?: string): void;
  error(msg: string): void;
  fatal?(obj: any, msg?: string): void;
  fatal?(msg: string): void;
}

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed within the window
   */
  maxRequests?: number;
  /**
   * Time window in milliseconds
   */
  windowMs?: number;
}

/**
 * Configuration for rate limit groups
 * Each group can contain multiple endpoints that share the same rate limit
 *
 * Special group 'global': Automatically applies to ALL endpoints without needing to specify endpoints
 *
 * @example
 * {
 *   // Global limit applies to all endpoints (no endpoints field needed)
 *   global: {
 *     config: { maxRequests: 50, windowMs: 1000 },
 *   },
 *   // Per-endpoint limit (only applies to specific endpoints)
 *   createWallet: {
 *     config: { maxRequests: 10, windowMs: 60000 },
 *     endpoints: ['createWallet'],
 *   }
 * }
 */
export interface RateLimitGroups {
  [groupName: string]: {
    config: RateLimitConfig;
    endpoints?: string[];
  };
}

export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private limitMaps: Map<string, Map<string, RateLimitEntry>> = new Map();

  constructor(
    private readonly groups: RateLimitGroups,
    private readonly logger?: Logger,
  ) {}

  /**
   * Wait for rate limit availability before proceeding
   * Checks all groups that contain this endpoint
   * @param endpoint - The endpoint name
   */
  async waitForLimit(endpoint: string): Promise<void> {
    const relevantGroups = this.getGroupsForEndpoint(endpoint);

    for (const groupName of relevantGroups) {
      const group = this.groups[groupName];
      if (group && group.config.maxRequests && group.config.windowMs) {
        await this.checkAndWaitForLimit(groupName, group.config, Date.now());
      }
    }
  }

  private getGroupsForEndpoint(endpoint: string): string[] {
    const groups: string[] = [];

    for (const [groupName, group] of Object.entries(this.groups)) {
      // Special handling for 'global' group - applies to all endpoints
      if (groupName === 'global' || group.endpoints?.includes(endpoint)) {
        groups.push(groupName);
      }
    }

    return groups;
  }

  private async checkAndWaitForLimit(
    groupName: string,
    config: RateLimitConfig,
    now: number,
  ): Promise<void> {
    const limitMap = this.getOrCreateGroupMap(groupName);
    let entry = limitMap.get(groupName);

    // Initialize or reset if window has passed
    if (!entry || now >= entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs!,
      };
      limitMap.set(groupName, entry);
    }

    // Check if rate limit is exceeded
    if (entry.count >= config.maxRequests!) {
      const waitTime = entry.resetTime - now;

      if (waitTime > 0) {
        this.logger?.warn(
          {
            group: groupName,
            waitTime,
            maxRequests: config.maxRequests,
            windowMs: config.windowMs,
          },
          `Rate limit exceeded for group '${groupName}', waiting ${waitTime}ms`,
        );

        // Wait for the window to reset
        await new Promise(resolve => setTimeout(resolve, waitTime));

        // After waiting, recursively check again to handle concurrent requests
        // This ensures we don't exceed the limit even when multiple requests wait
        return this.checkAndWaitForLimit(groupName, config, Date.now());
      }
    }

    // Increment the counter atomically
    // Re-fetch to ensure we have the latest entry
    entry = limitMap.get(groupName)!;
    entry.count++;
    limitMap.set(groupName, entry);
  }

  private getOrCreateGroupMap(groupName: string): Map<string, RateLimitEntry> {
    let map = this.limitMaps.get(groupName);
    if (!map) {
      map = new Map();
      this.limitMaps.set(groupName, map);
    }
    return map;
  }

  /**
   * Clear all rate limit counters (useful for testing)
   */
  reset(): void {
    this.limitMaps.clear();
  }

  /**
   * Get current rate limit status for debugging
   */
  getStatus(): Record<string, RateLimitEntry> {
    const status: Record<string, RateLimitEntry> = {};

    this.limitMaps.forEach((map, groupName) => {
      const entry = map.get(groupName);
      if (entry) {
        status[groupName] = entry;
      }
    });

    return status;
  }
}
