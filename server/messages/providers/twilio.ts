import fs from "fs";
import path from "path";

function readEnvFileValue(key: string): string | undefined {
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return undefined;
    const envContent = fs.readFileSync(envPath, "utf8");
    const match = envContent.match(new RegExp(`^${key}=(.+)$`, "m"));
    return match ? match[1].replace(/^"|"$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

function getRequiredEnv(key: string): string {
  const value = process.env[key] || readEnvFileValue(key);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function getTwilioAuthHeaders(): Record<string, string> {
  const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID");
  const authToken = getRequiredEnv("TWILIO_AUTH_TOKEN");
  return {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
}

function getTwilioMessagesBaseUrl(): string {
  const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID");
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages`;
}

function getTwilioErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;
  if (errorCode === "30032") {
    return "Twilio toll-free sender is not verified for US/Canada messaging.";
  }
  return null;
}

export interface TwilioSmsRequest {
  to: string;
  body: string;
  statusCallbackUrl?: string | null;
}

export interface TwilioSmsResult {
  success: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerPayload?: unknown;
  errorMessage?: string | null;
}

export async function sendTwilioSms(request: TwilioSmsRequest): Promise<TwilioSmsResult> {
  const fromNumber = getRequiredEnv("TWILIO_FROM_NUMBER");

  const body = new URLSearchParams({
    To: request.to,
    From: fromNumber,
    Body: request.body,
  });
  if (request.statusCallbackUrl) {
    body.set("StatusCallback", request.statusCallbackUrl);
  }

  const response = await fetch(`${getTwilioMessagesBaseUrl()}.json`, {
    method: "POST",
    headers: {
      ...getTwilioAuthHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => null) as {
    sid?: string;
    status?: string;
    message?: string;
    detail?: string;
    code?: number | string;
  } | null;
  if (!response.ok) {
    return {
      success: false,
      providerMessageId: payload?.sid ?? null,
      providerStatus: payload?.status ?? "failed",
      providerErrorCode: payload?.code != null ? String(payload.code) : null,
      providerPayload: payload,
      errorMessage:
        payload?.message ||
        payload?.detail ||
        getTwilioErrorMessage(payload?.code != null ? String(payload.code) : null) ||
        `Twilio SMS failed with status ${response.status}`,
    };
  }

  return {
    success: true,
    providerMessageId: payload?.sid ?? null,
    providerStatus: payload?.status ?? "accepted",
    providerErrorCode: null,
    providerPayload: payload,
    errorMessage: null,
  };
}

export async function fetchTwilioMessageStatus(messageSid: string): Promise<TwilioSmsResult> {
  const response = await fetch(`${getTwilioMessagesBaseUrl()}/${messageSid}.json`, {
    method: "GET",
    headers: getTwilioAuthHeaders(),
  });

  const payload = await response.json().catch(() => null) as {
    sid?: string;
    status?: string;
    error_code?: number | string | null;
    error_message?: string | null;
  } | null;

  if (!response.ok) {
    return {
      success: false,
      providerMessageId: payload?.sid ?? messageSid,
      providerStatus: payload?.status ?? "failed",
      providerErrorCode: payload?.error_code != null ? String(payload.error_code) : null,
      providerPayload: payload,
      errorMessage: payload?.error_message ?? `Twilio status fetch failed with status ${response.status}`,
    };
  }

  const status = payload?.status ?? "unknown";
  return {
    success: status !== "failed" && status !== "undelivered" && status !== "canceled",
    providerMessageId: payload?.sid ?? messageSid,
    providerStatus: status,
    providerErrorCode: payload?.error_code != null ? String(payload.error_code) : null,
    providerPayload: payload,
    errorMessage:
      payload?.error_message ??
      getTwilioErrorMessage(payload?.error_code != null ? String(payload.error_code) : null) ??
      null,
  };
}
