// api.test.ts
import { API, APIError } from "../../src/common/api";

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
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve(errorResponse),
      });

      await expect(api.request("GET", "/test")).rejects.toThrow(APIError);
    });

    it("should clear timeout if request completes before timeout", async () => {
      const requestTimeout = 5000;
      const mockSuccessData = { data: "success" };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSuccessData,
      } as Response);

      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      const response = await api.request("GET", "/fast-operation", {
        timeout: requestTimeout,
      });

      expect(response).toEqual(mockSuccessData);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // to ensure setTimeout is called to set timeout
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      const timerId = setTimeoutSpy.mock.results[0].value;

      // to ensure clearTimeout is called with the correct timerId
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);

      // to ensure signal is not aborted
      const fetchOptions = (global.fetch as jest.Mock).mock
        .calls[0][1] as RequestInit;
      expect(fetchOptions?.signal?.aborted).toBe(false);

      // to ensure the timer is not advanced even if it exceeds the original timeout (because the timer has been cleared)
      jest.advanceTimersByTime(requestTimeout + 100);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it("should abort request and throw AbortError if request exceeds timeout", async () => {
      const requestTimeout = 100;
      let capturedSignal: AbortSignal | null | undefined;

      // mock the global fetch function
      global.fetch = jest.fn(
        (_url: URL | RequestInfo, options?: RequestInit): Promise<Response> => {
          capturedSignal = options?.signal; // capture the signal

          return new Promise((_resolve, reject) => {
            // check if the signal is already aborted (e.g. timeout is 0)
            if (options?.signal?.aborted) {
              const abortError = new Error("The operation was aborted.");
              (abortError as any).name = "AbortError"; // mock AbortError
              reject(abortError);
              return;
            }

            // listen to abort event
            options?.signal?.addEventListener("abort", () => {
              const abortError = new Error("The operation was aborted.");
              (abortError as any).name = "AbortError"; // mock AbortError
              reject(abortError);
            });
          });
        }
      ) as jest.Mock;

      // watch if clearTimeout is called
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

      // make a request and expect it to fail because of timeout
      const requestPromise = api.request("GET", "/long-running-operation", {
        timeout: requestTimeout,
      });

      // to ensure fetch is called once
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // advance time to exceed the requestTimeout
      jest.advanceTimersByTime(requestTimeout + 50);

      // to ensure requestPromise is rejected and the error message is as expected
      await expect(requestPromise).rejects.toThrow(
        "The operation was aborted."
      );

      // to ensure the error is of the correct type (name)
      try {
        await requestPromise;
      } catch (error: any) {
        expect(error.name).toBe("AbortError");
        expect(error instanceof APIError).toBe(false);
      }

      // to ensure the signal is aborted
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(true);
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
});
