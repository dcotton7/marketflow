/** Shared by the gateway-reads tests: a tolerance check and a throwaway HTTP server. */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";

export const near = (a: number | null, b: number, msg: string, eps = 0.011) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

export async function withApp(app: express.Express, fn: (get: (path: string) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn((path) => new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: b ? JSON.parse(b) : null }));
      }).on("error", reject);
    }));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
