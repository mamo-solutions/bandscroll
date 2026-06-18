import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { errorHandler } from "./errorHandler.js";

function mockRes(headersSent = false) {
  const res = {
    headersSent,
    statusCode: 200,
    status: vi.fn(function (this: Response, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

const req = { method: "GET", originalUrl: "/api/boom" } as Request;

describe("errorHandler", () => {
  it("responds 500 with a generic body and does not call next", () => {
    // Logging goes through a child logger to console; here we pin the response
    // contract (the log line is exercised by the integration suite).
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(new Error("kaboom"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "internal" });
    expect(next).not.toHaveBeenCalled();
  });

  it("delegates to next when headers are already sent", () => {
    const res = mockRes(true);
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(new Error("late"), req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("wraps a non-Error rejection value without throwing", () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    expect(() => errorHandler("string failure", req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
