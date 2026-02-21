import fetch from "node-fetch";
import { readHaConfig } from "./haConfig.js";

const DEFAULT_TIMEOUT_MS = 8000;

function buildUrl(pathname) {
  const { haHost } = readHaConfig();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${haHost}${normalizedPath}`;
}

async function haRequest(method, pathname, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { haToken } = readHaConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(pathname), {
      method,
      headers: {
        Authorization: `Bearer ${haToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const error = new Error(`Home Assistant ${method} ${pathname} failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`Home Assistant ${method} ${pathname} timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function haGet(pathname, options) {
  return haRequest("GET", pathname, undefined, options);
}

export function haPost(pathname, body, options) {
  return haRequest("POST", pathname, body, options);
}

export function haPatch(pathname, body, options) {
  return haRequest("PATCH", pathname, body, options);
}

export function haDelete(pathname, options) {
  return haRequest("DELETE", pathname, undefined, options);
}
