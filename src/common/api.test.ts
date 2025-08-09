import { API, APIError } from "./api";

// mock the global fetch function
global.fetch = jest.fn();

describe("API Class", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  describe("Constructor", () => {
    it("should create instance with config", () => {
      const api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });

      expect(api["apiKey"]).toBe("test-key");
      expect(api["apiUri"]).toBe("https://api.fake.com");
    });

    it("should create instance with empty config", () => {
      const api = new API({});

      expect(api["apiKey"]).toBe("");
      expect(api["apiUri"]).toBe("");
    });
  });

  describe("setEndpoint", () => {
    it("should update endpoint", () => {
      const api = new API({});
      api.setEndpoint("https://new-api.fake.com");

      expect(api["apiUri"]).toBe("https://new-api.fake.com");
    });
  });

  // test request method
  describe("request", () => {
    let api: API;

    beforeEach(() => {
      api = new API({
        apiKey: "test-key",
        endpoint: "https://api.fake.com",
      });
    });

    it("should make successful request", async () => {
      const mockResponse = { data: "test" };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await api.request("GET", "/test", {
        params: { key: "value" },
      });

      // to ensure fetch is called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.fake.com/test?key=value",
        expect.objectContaining({
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "test-key",
          },
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it("should handle array parameters correctly", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.request("GET", "/test", {
        params: { items: ["a", "b", "c"] },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.fake.com/test?items=a&items=b&items=c",
        expect.any(Object)
      );
    });

    it("should handle request failure", async () => {
      const errorResponse = { message: "Not Found" };
      const mockResponse = {
        ok: false,
        status: 404,
        json: () => Promise.resolve(errorResponse),
        clone: () => mockResponse,
        text: () => Promise.resolve("Not Found"),
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

      await expect(api.request("GET", "/test")).rejects.toThrow(APIError);
    });

    it("should handle JSON body", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const jsonData = { test: "data" };
      await api.request("POST", "/test", {
        json: jsonData,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(jsonData),
        })
      );
    });
  });

  describe("URL construction", () => {
    beforeEach(() => {
      // Mock successful fetch for these URL construction tests
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });
    });

    it("should handle absolute API URLs", async () => {
      const api = new API({
        apiKey: "test-key",
        endpoint: "https://api.example.com",
      });

      await api.request("GET", "/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.any(Object)
      );
    });

    it("should handle relative API URLs in browser environment", async () => {
      // Mock window.location for browser environment
      const originalWindow = global.window;
      (global as any).window = {
        location: {
          origin: "https://example.com",
        },
      };

      const api = new API({
        apiKey: "test-key",
        endpoint: "/api/v1",
      });

      await api.request("GET", "/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/api/v1/test",
        expect.any(Object)
      );

      // Restore original window
      (global as any).window = originalWindow;
    });

    it("should throw error for relative API URLs in Node.js environment", async () => {
      // Ensure we're in Node.js environment (no window)
      const originalWindow = global.window;
      delete (global as any).window;

      const api = new API({
        apiKey: "test-key",
        endpoint: "/api/v1",
      });

      await expect(api.request("GET", "/test")).rejects.toThrow(
        "Relative API URL not supported in Node.js environment"
      );

      // Restore original window
      (global as any).window = originalWindow;
    });

    it("should handle protocol-relative URLs", async () => {
      const api = new API({
        apiKey: "test-key",
        endpoint: "//api.example.com",
      });

      await api.request("GET", "/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/test", // Protocol-relative URLs resolve to https
        expect.any(Object)
      );
    });

    it("should support Web Worker environment with self.location", async () => {
      // Mock Web Worker environment
      const originalWindow = global.window;
      const originalSelf = (global as any).self;
      
      delete (global as any).window;
      (global as any).self = {
        location: {
          origin: "https://worker.example.com",
        },
      };

      const api = new API({
        apiKey: "test-key",
        endpoint: "/api/v1",
      });

      await api.request("GET", "/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://worker.example.com/api/v1/test",
        expect.any(Object)
      );

      // Restore environment
      (global as any).window = originalWindow;
      (global as any).self = originalSelf;
    });
  });
});