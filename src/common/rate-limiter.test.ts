import { RateLimiter, RateLimitGroups } from './rate-limiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Single endpoint rate limiting', () => {
    it('should allow requests within the rate limit', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { maxRequests: 3, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Should allow 3 requests without blocking
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      const status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(3);
    });

    it('should block requests exceeding the rate limit', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // First 2 requests should pass immediately
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      // 3rd request should wait
      const promise = rateLimiter.waitForLimit('createWallet');

      // Fast forward time to just before the window resets
      jest.advanceTimersByTime(999);

      // Should still be waiting
      let resolved = false;
      promise.then(() => { resolved = true; });
      await jest.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      // Fast forward to after the window resets
      await jest.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('should reset counter after window expires', async () => {
      const groups: RateLimitGroups = {
        getWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['getWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up the limit
      await rateLimiter.waitForLimit('getWallet');
      await rateLimiter.waitForLimit('getWallet');

      // Advance time past the window
      await jest.advanceTimersByTimeAsync(1000);

      // Should allow requests again
      await rateLimiter.waitForLimit('getWallet');
      const status = rateLimiter.getStatus();
      expect(status.getWallet?.count).toBe(1);
    });
  });

  describe('Global rate limiting', () => {
    it('should apply global limit to all endpoints', async () => {
      const groups: RateLimitGroups = {
        global: {
          config: { maxRequests: 5, windowMs: 1000 },
          endpoints: ['createWallet', 'getWallet', 'signTransaction'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Mix of different endpoints
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('getWallet');
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('signTransaction');
      await rateLimiter.waitForLimit('getWallet');

      const status = rateLimiter.getStatus();
      expect(status.global?.count).toBe(5);
    });

    it('should block any endpoint when global limit is reached', async () => {
      const groups: RateLimitGroups = {
        global: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet', 'getWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up global limit with createWallet
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      // getWallet should now be blocked even though it hasn't been called
      const promise = rateLimiter.waitForLimit('getWallet');

      let resolved = false;
      promise.then(() => { resolved = true; });
      await jest.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      // After window expires, should be allowed
      await jest.advanceTimersByTimeAsync(1000);
      expect(resolved).toBe(true);
    });
  });

  describe('Multiple groups with overlapping endpoints', () => {
    it('should check all relevant groups for an endpoint', async () => {
      const groups: RateLimitGroups = {
        global: {
          config: { maxRequests: 10, windowMs: 1000 },
          endpoints: ['createWallet', 'getWallet', 'signTransaction'],
        },
        createWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // createWallet should be limited by its specific limit (2)
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      // Check that createWallet group has 2, and global has 2
      let status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(2);
      expect(status.global?.count).toBe(2);

      // 3rd request should wait because createWallet limit is reached
      // Note: it will increment global counter before waiting on createWallet limit
      const promise = rateLimiter.waitForLimit('createWallet');

      let resolved = false;
      promise.then(() => { resolved = true; });
      await jest.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      // But getWallet should still work (only limited by global, which has room)
      await rateLimiter.waitForLimit('getWallet');

      // Now global should have 4 (2 createWallet + 1 blocked createWallet that incremented global + 1 getWallet)
      status = rateLimiter.getStatus();
      expect(status.global?.count).toBe(4);

      // Now let the blocked createWallet resolve
      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      // After resolution, the counters reset because 1000ms has passed (the window duration)
      status = rateLimiter.getStatus();
      expect(status.global?.count).toBe(4); // Still at 4 since window hasn't fully expired
      expect(status.createWallet?.count).toBe(1); // Resets to 1 (the call after waiting)
    });

    it('should wait for the most restrictive limit', async () => {
      const groups: RateLimitGroups = {
        global: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet', 'getWallet'],
        },
        walletGroup: {
          config: { maxRequests: 5, windowMs: 2000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up global limit
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      // Next request should be blocked by global limit (1000ms window)
      const promise = rateLimiter.waitForLimit('createWallet');

      let resolved = false;
      promise.then(() => { resolved = true; });

      // After 1000ms, global limit resets but walletGroup still has room
      await jest.advanceTimersByTimeAsync(1000);
      expect(resolved).toBe(true);
    });
  });

  describe('Optional rate limiting', () => {
    it('should allow unlimited requests when no groups are configured', async () => {
      const groups: RateLimitGroups = {};
      rateLimiter = new RateLimiter(groups);

      // Should allow any number of requests
      for (let i = 0; i < 100; i++) {
        await rateLimiter.waitForLimit('createWallet');
      }

      // Should complete without waiting
      const status = rateLimiter.getStatus();
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('should allow unlimited requests when endpoint is not in any group', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // getWallet is not rate limited
      for (let i = 0; i < 100; i++) {
        await rateLimiter.waitForLimit('getWallet');
      }

      const status = rateLimiter.getStatus();
      expect(status.getWallet).toBeUndefined();
    });

    it('should allow unlimited requests when config has no maxRequests', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { windowMs: 1000 }, // No maxRequests
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Should allow unlimited requests
      for (let i = 0; i < 100; i++) {
        await rateLimiter.waitForLimit('createWallet');
      }
    });
  });

  describe('reset', () => {
    it('should clear all rate limit counters', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      let status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(2);

      rateLimiter.reset();

      status = rateLimiter.getStatus();
      expect(Object.keys(status)).toHaveLength(0);

      // Should allow requests again without waiting
      await rateLimiter.waitForLimit('createWallet');
      status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(1);
    });
  });

  describe('Race condition handling', () => {
    it('should prevent race condition when multiple requests wait simultaneously', async () => {
      const groups: RateLimitGroups = {
        createWallet: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['createWallet'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up the limit
      await rateLimiter.waitForLimit('createWallet');
      await rateLimiter.waitForLimit('createWallet');

      let status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(2);

      // Start 3 concurrent requests that will all wait
      const promise1 = rateLimiter.waitForLimit('createWallet');
      const promise2 = rateLimiter.waitForLimit('createWallet');
      const promise3 = rateLimiter.waitForLimit('createWallet');

      // After 1000ms, only 2 requests should complete (respecting limit)
      await jest.advanceTimersByTimeAsync(1000);

      status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(2); // Only 2, respecting limit

      // Need another 1000ms for the 3rd request
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.all([promise1, promise2, promise3]);

      status = rateLimiter.getStatus();
      expect(status.createWallet?.count).toBe(1); // Last request in new window
    });

    it('should handle concurrent requests racing to increment counter', async () => {
      const groups: RateLimitGroups = {
        test: {
          config: { maxRequests: 10, windowMs: 1000 },
          endpoints: ['test'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Start 10 concurrent requests
      const promises = Array.from({ length: 10 }, () => rateLimiter.waitForLimit('test'));
      await Promise.all(promises);

      // Should have exactly 10 counted, not less due to race conditions
      const status = rateLimiter.getStatus();
      expect(status.test?.count).toBe(10);
    });

    it('should ensure only one request resets the counter after waiting', async () => {
      const groups: RateLimitGroups = {
        limited: {
          config: { maxRequests: 1, windowMs: 500 },
          endpoints: ['limited'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // First request uses the limit
      await rateLimiter.waitForLimit('limited');
      expect(rateLimiter.getStatus().limited?.count).toBe(1);

      // Start 5 concurrent requests that will wait
      const requests = Array.from({ length: 5 }, () => rateLimiter.waitForLimit('limited'));

      // Each request needs 500ms window, so 5 requests need 2500ms total
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(500);
      }
      await Promise.all(requests);

      // Should have exactly 1 in final window (respecting limit)
      const status = rateLimiter.getStatus();
      expect(status.limited?.count).toBe(1);
    });
  });

  describe('Stale timestamp handling', () => {
    it('should use fresh timestamps when checking multiple groups sequentially', async () => {
      const groups: RateLimitGroups = {
        // First group with tight limit that will cause waiting
        group1: {
          config: { maxRequests: 1, windowMs: 1000 },
          endpoints: ['test'],
        },
        // Second group with higher limit
        group2: {
          config: { maxRequests: 10, windowMs: 1000 },
          endpoints: ['test'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up group1's limit
      await rateLimiter.waitForLimit('test');

      // This request should wait for group1, then check group2 with fresh timestamp
      const startTime = Date.now();
      const promise = rateLimiter.waitForLimit('test');

      // Advance time to let group1's window reset
      await jest.advanceTimersByTimeAsync(1000);
      await promise;

      const elapsed = Date.now() - startTime;

      // Should have waited ~1000ms for group1, not more
      // If timestamp was stale, it might wait incorrectly for group2
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(elapsed).toBeLessThan(1500); // Should not wait for group2

      const status = rateLimiter.getStatus();
      expect(status.group1?.count).toBe(1);
      expect(status.group2?.count).toBe(1); // After reset, only 1 request went through
    });

    it('should correctly calculate wait times after waiting for earlier group', async () => {
      const groups: RateLimitGroups = {
        slowGroup: {
          config: { maxRequests: 1, windowMs: 500 },
          endpoints: ['endpoint'],
        },
        fastGroup: {
          config: { maxRequests: 2, windowMs: 1000 },
          endpoints: ['endpoint'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // First request
      await rateLimiter.waitForLimit('endpoint');

      let status = rateLimiter.getStatus();
      expect(status.slowGroup?.count).toBe(1);
      expect(status.fastGroup?.count).toBe(1);

      // Second request hits slowGroup limit
      const promise = rateLimiter.waitForLimit('endpoint');

      // Need to wait for slowGroup's window (500ms)
      await jest.advanceTimersByTimeAsync(500);
      await promise;

      status = rateLimiter.getStatus();
      // slowGroup resets and increments to 1, fastGroup increments to 2
      expect(status.slowGroup?.count).toBe(1);
      expect(status.fastGroup?.count).toBe(2);
    });

    it('should not use expired window checks with stale timestamps', async () => {
      const groups: RateLimitGroups = {
        group1: {
          config: { maxRequests: 1, windowMs: 200 },
          endpoints: ['test'],
        },
        group2: {
          config: { maxRequests: 1, windowMs: 500 },
          endpoints: ['test'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Use up both limits
      await rateLimiter.waitForLimit('test');

      const promise = rateLimiter.waitForLimit('test');

      // Advance 200ms - group1's window expires but group2's doesn't
      await jest.advanceTimersByTimeAsync(200);

      // At this point, if timestamp was stale, group2 might not wait correctly
      // Advance remaining time for group2
      await jest.advanceTimersByTimeAsync(300);
      await promise;

      const status = rateLimiter.getStatus();
      // Both should have been properly reset and incremented
      expect(status.group1?.count).toBe(1);
      expect(status.group2?.count).toBe(1);
    });
  });

  describe('Rate limit enforcement verification', () => {
    it('should enforce exactly 100 requests per second limit', async () => {
      const groups: RateLimitGroups = {
        strict: {
          config: { maxRequests: 100, windowMs: 1000 },
          endpoints: ['test'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      const requests: Promise<void>[] = [];
      const completedCount: { before: number; after: number } = { before: 0, after: 0 };
      const startTime = Date.now();

      // Fire 150 concurrent requests
      for (let i = 0; i < 150; i++) {
        requests.push(
          rateLimiter.waitForLimit('test').then(() => {
            const elapsed = Date.now() - startTime;
            if (elapsed < 1000) {
              completedCount.before++;
            } else {
              completedCount.after++;
            }
          })
        );
      }

      // Let first 100 complete immediately
      await jest.advanceTimersByTimeAsync(0);

      // At this point, 100 should have completed, 50 should be waiting
      expect(completedCount.before).toBe(100);
      expect(completedCount.after).toBe(0);

      // Advance time to let the remaining 50 complete
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.all(requests);

      // After 1 second, all 150 should be complete
      expect(completedCount.before).toBe(100); // First 100 within 1s
      expect(completedCount.after).toBe(50);   // Remaining 50 after 1s

      const status = rateLimiter.getStatus();
      expect(status.strict?.count).toBe(50); // Only 50 in the new window
    });

    it('should never exceed configured limit within any window', async () => {
      const groups: RateLimitGroups = {
        test: {
          config: { maxRequests: 10, windowMs: 500 },
          endpoints: ['endpoint'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Fire 35 requests and track completions per window
      const requests: Promise<void>[] = [];
      const completionTimes: number[] = [];
      const startTime = Date.now();

      for (let i = 0; i < 35; i++) {
        requests.push(
          rateLimiter.waitForLimit('endpoint').then(() => {
            completionTimes.push(Date.now() - startTime);
          })
        );
      }

      // Advance time to process all requests
      for (let i = 0; i < 4; i++) {
        await jest.advanceTimersByTimeAsync(500);
      }

      await Promise.all(requests);

      // Verify no more than 10 requests completed in any 500ms window
      const windows = [
        { start: 0, end: 500 },
        { start: 500, end: 1000 },
        { start: 1000, end: 1500 },
        { start: 1500, end: 2000 },
      ];

      windows.forEach((window) => {
        const countInWindow = completionTimes.filter(
          (t) => t >= window.start && t < window.end
        ).length;
        expect(countInWindow).toBeLessThanOrEqual(10);
      });

      // Should have used all 4 windows
      expect(completionTimes.length).toBe(35);
    });

    it('should accurately track request count throughout execution', async () => {
      const groups: RateLimitGroups = {
        counter: {
          config: { maxRequests: 5, windowMs: 200 },
          endpoints: ['test'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      // Phase 1: Use up the limit (5 requests)
      const phase1 = Array.from({ length: 5 }, () => rateLimiter.waitForLimit('test'));
      await Promise.all(phase1);

      let status = rateLimiter.getStatus();
      expect(status.counter?.count).toBe(5);

      // Phase 2: Next 3 requests should wait
      const phase2Start = Date.now();
      const phase2 = Array.from({ length: 3 }, () => rateLimiter.waitForLimit('test'));

      // Advance time to let them complete
      await jest.advanceTimersByTimeAsync(200);
      await Promise.all(phase2);

      const phase2Duration = Date.now() - phase2Start;

      // Should have waited ~200ms
      expect(phase2Duration).toBeGreaterThanOrEqual(200);

      status = rateLimiter.getStatus();
      expect(status.counter?.count).toBe(3); // 3 in new window

      // Phase 3: Use remaining 2 slots + 2 more (should wait)
      const phase3 = Array.from({ length: 4 }, () => rateLimiter.waitForLimit('test'));

      await jest.advanceTimersByTimeAsync(0);
      status = rateLimiter.getStatus();
      expect(status.counter?.count).toBe(5); // First 2 used remaining slots

      // Advance for final 2
      await jest.advanceTimersByTimeAsync(200);
      await Promise.all(phase3);

      status = rateLimiter.getStatus();
      expect(status.counter?.count).toBe(2); // Final 2 in new window
    });

    it('should handle burst traffic correctly by enforcing wait times', async () => {
      const groups: RateLimitGroups = {
        burst: {
          config: { maxRequests: 20, windowMs: 1000 },
          endpoints: ['api'],
        },
      };

      rateLimiter = new RateLimiter(groups);

      const timestamps: number[] = [];
      const startTime = Date.now();

      // Simulate burst: fire 60 requests at once
      const requests = Array.from({ length: 60 }, () =>
        rateLimiter.waitForLimit('api').then(() => {
          timestamps.push(Date.now() - startTime);
        })
      );

      // Process all requests
      await jest.advanceTimersByTimeAsync(0);    // First 20
      await jest.advanceTimersByTimeAsync(1000); // Next 20
      await jest.advanceTimersByTimeAsync(1000); // Last 20
      await Promise.all(requests);

      // Verify that no more than 20 requests completed in any 1000ms window
      const windows = [
        { start: 0, end: 1000 },
        { start: 1000, end: 2000 },
        { start: 2000, end: 3000 },
      ];

      windows.forEach((window) => {
        const countInWindow = timestamps.filter(
          (t) => t >= window.start && t < window.end
        ).length;
        expect(countInWindow).toBeLessThanOrEqual(20);
      });

      // All 60 should have completed
      expect(timestamps.length).toBe(60);

      const status = rateLimiter.getStatus();
      expect(status.burst?.count).toBe(20); // Last window has 20
    });
  });
});
