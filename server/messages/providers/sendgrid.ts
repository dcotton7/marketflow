import fs from "fs";
import path from "path";
import sgMail from "@sendgrid/mail";

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

export interface SendGridEmailRequest {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface SendGridEmailResult {
  success: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerPayload?: unknown;
  errorMessage?: string | null;
}

export async function sendSendGridEmail(request: SendGridEmailRequest): Promise<SendGridEmailResult> {
  const apiKey = getRequiredEnv("SENDGRID_API_KEY");
  const fromEmail = getRequiredEnv("ALERTS_FROM_EMAIL");
  sgMail.setApiKey(apiKey);

  try {
    const [response] = await sgMail.send({
      to: request.to,
      from: fromEmail,
      subject: request.subject,
      text: request.text,
      html: request.html,
    });

    const messageId = response.headers["x-message-id"] as string | undefined;
    return {
      success: true,
      providerMessageId: messageId ?? null,
      providerStatus: response.statusCode === 202 ? "accepted" : String(response.statusCode),
      providerErrorCode: null,
      providerPayload: {
        statusCode: response.statusCode,
        headers: response.headers,
      },
      errorMessage: null,
    };
  } catch (error: unknown) {
    const maybeError = error as { response?: { body?: unknown }; code?: string; message?: string };
    return {
      success: false,
      providerMessageId: null,
      providerStatus: "failed",
      providerErrorCode: maybeError?.code ?? null,
      providerPayload: maybeError?.response?.body ?? null,
      errorMessage: maybeError?.message ?? "SendGrid email failed",
    };
  }
}
