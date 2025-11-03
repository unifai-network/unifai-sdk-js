import { API, APIError } from "./api";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("API Class", () => {
  let mockAxiosInstance: any;
  let mockDirectAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instances
    mockAxiosInstance = {
      request: jest.fn(),
      defaults: { baseURL: "" },
    };
    mockDirectAxiosInstance = {
      request: jest.fn(),
      defaults: { baseURL: "" },
    };

    // Mock axios.create to return our mock instances
    mockedAxios.create
      .mockReturnValueOnce(mockAxiosInstance)
      .mockReturnValueOnce(mockDirectAxiosInstance);
  });

  describe("Constructor", () => {
    it("should create instance with config", () => {
      const api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });

      expect(api["apiKey"]).toBe("test-key");
      expect(api["apiKeyHeader"]).toBe("Authorization"); // Default header
      expect(api["apiUri"]).toBe("https://api.fake.com");
      expect(api["timeout"]).toBe(10000); // Default timeout
    });

    it("should create instance with custom API key header", () => {
      const api = new API({
        apiKey: "test-key",
        apiKeyHeader: "X-API-Key",
        endpoint: "https://api.fake.com",
      });

      expect(api["apiKey"]).toBe("test-key");
      expect(api["apiKeyHeader"]).toBe("X-API-Key");
    });

    it("should create instance with custom timeout", () => {
      const api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
        timeout: 5000,
      });

      expect(api["timeout"]).toBe(5000);
    });

    it("should create instance with empty config", () => {
      const api = new API({});

      expect(api["apiKey"]).toBe("");
      expect(api["apiUri"]).toBe("");
      expect(api["timeout"]).toBe(10000);
    });

    it("should create axios instances with proxy config (SOCKS5)", () => {
      const api = new API({
        endpoint: "https://api.fake.com",
        proxy: {
          protocol: "socks5",
          host: "proxy.example.com",
          port: 1080,
          auth: {
            username: "user",
            password: "pass",
          },
        },
      });

      expect(mockedAxios.create).toHaveBeenCalledTimes(2);
      expect(api["proxyConfig"]).toBeDefined();
    });

    it("should create axios instances with proxy config (HTTP)", () => {
      const api = new API({
        endpoint: "https://api.fake.com",
        proxy: {
          protocol: "http",
          host: "proxy.example.com",
          port: 8080,
        },
      });

      expect(mockedAxios.create).toHaveBeenCalledTimes(2);
      expect(api["proxyConfig"]).toBeDefined();
    });
  });

  describe("setEndpoint", () => {
    it("should update endpoint", () => {
      const api = new API({});
      api.setEndpoint("https://new-api.fake.com");

      expect(api["apiUri"]).toBe("https://new-api.fake.com");
    });

    it("should update axios instances baseURL", () => {
      const api = new API({
        endpoint: "https://old-api.fake.com",
      });

      // Set baseURL in mocks to simulate what axios.create did
      mockAxiosInstance.defaults.baseURL = "https://old-api.fake.com";
      mockDirectAxiosInstance.defaults.baseURL = "https://old-api.fake.com";

      api.setEndpoint("https://new-api.fake.com");

      expect(api["apiUri"]).toBe("https://new-api.fake.com");
      expect(mockAxiosInstance.defaults.baseURL).toBe("https://new-api.fake.com");
      expect(mockDirectAxiosInstance.defaults.baseURL).toBe("https://new-api.fake.com");
    });
  });

  describe("request", () => {
    let api: API;

    beforeEach(() => {
      api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });
    });

    it("should make successful request", async () => {
      const mockResponse = { data: { result: "test" } };
      mockAxiosInstance.request.mockResolvedValueOnce(mockResponse);

      const result = await api.request("GET", "/test", {
        params: { key: "value" },
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: "GET",
        url: "/test",
        headers: {
          Authorization: "test-key",
        },
        params: { key: "value" },
        data: undefined,
        timeout: 10000,
      });

      expect(result).toEqual({ result: "test" });
    });

    it("should handle JSON body", async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({ data: {} });

      const jsonData = { test: "data" };
      await api.request("POST", "/test", {
        json: jsonData,
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: "POST",
        url: "/test",
        headers: {
          Authorization: "test-key",
        },
        params: undefined,
        data: jsonData,
        timeout: 10000,
      });
    });

    it("should handle custom timeout", async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({ data: {} });

      await api.request("GET", "/test", {
        timeout: 5000,
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it("should use custom API key header", async () => {
      const mockCustomHeaderInstance = {
        request: jest.fn(),
      };
      const mockCustomHeaderDirectInstance = {
        request: jest.fn(),
      };

      mockedAxios.create
        .mockReturnValueOnce(mockCustomHeaderInstance as any)
        .mockReturnValueOnce(mockCustomHeaderDirectInstance as any);

      const apiCustomHeader = new API({
        apiKey: "custom-key",
        apiKeyHeader: "X-API-Key",
        endpoint: "https://api.fake.com",
      });

      mockCustomHeaderInstance.request.mockResolvedValueOnce({ data: {} });

      await apiCustomHeader.request("GET", "/test");

      expect(mockCustomHeaderInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            "X-API-Key": "custom-key",
          },
        })
      );
    });

    it("should handle request failure with response", async () => {
      const errorResponse = {
        response: {
          status: 404,
          data: { message: "Not Found" },
        },
      };
      mockAxiosInstance.request.mockRejectedValueOnce(errorResponse);

      await expect(api.request("GET", "/test")).rejects.toThrow(APIError);
    });

    it("should handle request failure without response", async () => {
      const errorResponse = {
        code: "ECONNREFUSED",
        message: "Connection refused",
      };
      mockAxiosInstance.request.mockRejectedValueOnce(errorResponse);

      await expect(api.request("GET", "/test")).rejects.toMatchObject({
        code: "ECONNREFUSED",
      });
    });
  });

  describe("Proxy fallback", () => {
    let api: API;

    beforeEach(() => {
      api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
        proxy: {
          host: "proxy.example.com",
          port: 1080,
          fallbackToDirect: true,
        },
      });
    });

    it("should fallback to direct connection on proxy error (no response)", async () => {
      const proxyError = {
        code: "ECONNREFUSED",
        message: "Connection refused",
      };
      const directResponse = { data: { result: "success" } };

      mockAxiosInstance.request.mockRejectedValueOnce(proxyError);
      mockDirectAxiosInstance.request.mockResolvedValueOnce(directResponse);

      const result = await api.request("GET", "/test");

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(mockDirectAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ result: "success" });
    });

    it("should fallback to direct connection on proxy authentication error", async () => {
      const proxyError = {
        response: {
          status: 407,
          data: { message: "Proxy Authentication Required" },
        },
      };
      const directResponse = { data: { result: "success" } };

      mockAxiosInstance.request.mockRejectedValueOnce(proxyError);
      mockDirectAxiosInstance.request.mockResolvedValueOnce(directResponse);

      const result = await api.request("GET", "/test");

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(mockDirectAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ result: "success" });
    });

    it("should fallback on gateway errors (502, 503, 504)", async () => {
      const proxyError = {
        response: {
          status: 502,
          data: { message: "Bad Gateway" },
        },
      };
      const directResponse = { data: { result: "success" } };

      mockAxiosInstance.request.mockRejectedValueOnce(proxyError);
      mockDirectAxiosInstance.request.mockResolvedValueOnce(directResponse);

      const result = await api.request("GET", "/test");

      expect(mockDirectAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ result: "success" });
    });

    it("should not fallback on API errors (400, 401, etc)", async () => {
      const apiError = {
        response: {
          status: 401,
          data: { message: "Unauthorized" },
        },
      };

      mockAxiosInstance.request.mockRejectedValueOnce(apiError);

      await expect(api.request("GET", "/test")).rejects.toThrow(APIError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(mockDirectAxiosInstance.request).not.toHaveBeenCalled();
    });

    it("should throw direct connection error if both fail", async () => {
      const proxyError = {
        code: "ECONNREFUSED",
        message: "Proxy connection refused",
      };
      const directError = {
        response: {
          status: 500,
          data: { message: "Internal Server Error" },
        },
      };

      mockAxiosInstance.request.mockRejectedValueOnce(proxyError);
      mockDirectAxiosInstance.request.mockRejectedValueOnce(directError);

      await expect(api.request("GET", "/test")).rejects.toThrow(APIError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
      expect(mockDirectAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("should not fallback when fallbackToDirect is false", async () => {
      // Create fresh mock instances for this test
      const mockProxyInstance = {
        request: jest.fn(),
      };
      const mockDirectInstance = {
        request: jest.fn(),
      };

      mockedAxios.create
        .mockReturnValueOnce(mockProxyInstance as any)
        .mockReturnValueOnce(mockDirectInstance as any);

      const apiWithoutFallback = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
        proxy: {
          host: "proxy.example.com",
          port: 1080,
          fallbackToDirect: false,
        },
      });

      const proxyError = {
        code: "ECONNREFUSED",
        message: "Connection refused",
      };

      mockProxyInstance.request.mockRejectedValueOnce(proxyError);

      await expect(apiWithoutFallback.request("GET", "/test")).rejects.toMatchObject({
        code: "ECONNREFUSED",
      });

      expect(mockProxyInstance.request).toHaveBeenCalledTimes(1);
      expect(mockDirectInstance.request).not.toHaveBeenCalled();
    });
  });

  describe("Retry with exponential backoff", () => {
    let api: API;

    beforeEach(() => {
      api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });
    });

    it("should use class-level retry config", async () => {
      // Create fresh mocks for new API instance
      const mockRetryInstance = {
        request: jest.fn(),
      };
      const mockRetryDirectInstance = {
        request: jest.fn(),
      };

      mockedAxios.create
        .mockReturnValueOnce(mockRetryInstance as any)
        .mockReturnValueOnce(mockRetryDirectInstance as any);

      const apiWithRetry = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
        maxRetries: 2,
        baseRetryDelay: 50,
      });

      const error = {
        response: {
          status: 500,
          data: { message: "Internal Server Error" }
        }
      };
      mockRetryInstance.request.mockRejectedValue(error);

      await expect(apiWithRetry.request("GET", "/test")).rejects.toThrow(APIError);

      // Should use class-level maxRetries (2)
      expect(mockRetryInstance.request).toHaveBeenCalledTimes(2);
    });

    it("should allow per-request retry override", async () => {
      // Create fresh mocks for new API instance
      const mockOverrideInstance = {
        request: jest.fn(),
      };
      const mockOverrideDirectInstance = {
        request: jest.fn(),
      };

      mockedAxios.create
        .mockReturnValueOnce(mockOverrideInstance as any)
        .mockReturnValueOnce(mockOverrideDirectInstance as any);

      const apiWithRetry = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
        maxRetries: 2,
        baseRetryDelay: 50,
      });

      const error = {
        response: {
          status: 500,
          data: { message: "Internal Server Error" }
        }
      };
      mockOverrideInstance.request.mockRejectedValue(error);

      // Override class-level config with per-request config
      await expect(
        apiWithRetry.request("GET", "/test", {
          maxRetries: 4,
        })
      ).rejects.toThrow(APIError);

      // Should use per-request maxRetries (4)
      expect(mockOverrideInstance.request).toHaveBeenCalledTimes(4);
    });

    it("should retry on failure and succeed", async () => {
      const successResponse = { data: { result: "success" } };

      // Fail twice, then succeed
      mockAxiosInstance.request
        .mockRejectedValueOnce({ code: "ECONNRESET", message: "Connection reset" })
        .mockRejectedValueOnce({ code: "ETIMEDOUT", message: "Timeout" })
        .mockResolvedValueOnce(successResponse);

      const result = await api.request("GET", "/test", {
        maxRetries: 3,
        baseRetryDelay: 10, // Small delay for testing
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ result: "success" });
    });

    it("should retry correct number of times and fail", async () => {
      // Use an API error (not proxy error) so it won't fallback
      const error = {
        response: {
          status: 500,
          data: { message: "Internal Server Error" }
        }
      };
      mockAxiosInstance.request.mockRejectedValue(error);

      await expect(
        api.request("GET", "/test", {
          maxRetries: 3,
          baseRetryDelay: 10,
        })
      ).rejects.toThrow(APIError);

      // Should retry 3 times without fallback (since it's not a proxy error)
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it("should not retry when maxRetries is 0 or not set", async () => {
      const error = { code: "ECONNREFUSED", message: "Connection refused" };
      mockAxiosInstance.request.mockRejectedValueOnce(error);

      await expect(api.request("GET", "/test")).rejects.toMatchObject({
        code: "ECONNREFUSED",
      });

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it("should use exponential backoff delays", async () => {
      // Create an API without proxy to avoid proxy fallback doubling the time
      const mockNoProxyInstance = {
        request: jest.fn(),
      };
      const mockNoProxyDirectInstance = {
        request: jest.fn(),
      };

      mockedAxios.create
        .mockReturnValueOnce(mockNoProxyInstance as any)
        .mockReturnValueOnce(mockNoProxyDirectInstance as any);

      const apiNoProxy = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });

      const error = {
        response: {
          status: 500,
          data: { message: "Internal Server Error" }
        }
      };
      mockNoProxyInstance.request.mockRejectedValue(error);

      const startTime = Date.now();

      await expect(
        apiNoProxy.request("GET", "/test", {
          maxRetries: 3,
          baseRetryDelay: 100, // 100ms base delay
        })
      ).rejects.toThrow();

      const duration = Date.now() - startTime;

      // With 3 retries, there are 2 delays between attempts:
      // Attempt 1 (fails) -> wait 100ms (2^0 * 100) -> Attempt 2 (fails) -> wait 200ms (2^1 * 100) -> Attempt 3 (fails)
      // Total: ~300ms minimum
      // Allow some variance for test execution time
      expect(duration).toBeGreaterThanOrEqual(250);
      expect(duration).toBeLessThan(500);
    });
  });

  describe("isProxyOrNetworkError", () => {
    let api: API;

    beforeEach(() => {
      api = new API({
        endpoint: "https://api.fake.com",
      });
    });

    it("should return true for errors without response", () => {
      const error = {
        code: "ECONNREFUSED",
        message: "Connection refused",
      };

      expect(api["isProxyOrNetworkError"](error)).toBe(true);
    });

    it("should return true for proxy authentication errors", () => {
      const error = {
        response: {
          status: 407,
        },
      };

      expect(api["isProxyOrNetworkError"](error)).toBe(true);
    });

    it("should return true for gateway errors", () => {
      expect(api["isProxyOrNetworkError"]({ response: { status: 502 } })).toBe(true);
      expect(api["isProxyOrNetworkError"]({ response: { status: 503 } })).toBe(true);
      expect(api["isProxyOrNetworkError"]({ response: { status: 504 } })).toBe(true);
    });

    it("should return true for 403 errors", () => {
      const error = {
        response: {
          status: 403,
        },
      };

      expect(api["isProxyOrNetworkError"](error)).toBe(true);
    });

    it("should return false for normal API errors", () => {
      expect(api["isProxyOrNetworkError"]({ response: { status: 400 } })).toBe(false);
      expect(api["isProxyOrNetworkError"]({ response: { status: 401 } })).toBe(false);
      expect(api["isProxyOrNetworkError"]({ response: { status: 404 } })).toBe(false);
      expect(api["isProxyOrNetworkError"]({ response: { status: 500 } })).toBe(false);
    });
  });
});
