import { sendTwilioSms } from "./providers/twilio";
import { sendSendGridEmail } from "./providers/sendgrid";

export interface MessageSendRequest {
  channel: "sms" | "email";
  to: string | string[];
  body?: string;
  subject?: string;
  html?: string;
  statusCallbackUrl?: string | null;
}

export interface MessageSendResult {
  success: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  providerPayload?: unknown;
  errorMessage?: string | null;
}

export async function sendMessage(request: MessageSendRequest): Promise<MessageSendResult> {
  if (request.channel === "sms") {
    if (!request.body) {
      return {
        success: false,
        providerMessageId: null,
        errorMessage: "SMS body is required",
      };
    }

    return sendTwilioSms({
      to: String(request.to),
      body: request.body,
      statusCallbackUrl: request.statusCallbackUrl,
    });
  }

  if (request.channel === "email") {
    if (!request.subject || (!request.body && !request.html)) {
      return {
        success: false,
        providerMessageId: null,
        errorMessage: "Email subject and body/html are required",
      };
    }

    const recipients = Array.isArray(request.to) ? request.to : [String(request.to)];
    return sendSendGridEmail({
      to: recipients,
      subject: request.subject,
      text: request.body,
      html: request.html,
    });
  }

  return {
    success: false,
    providerMessageId: null,
    errorMessage: `Unsupported message channel: ${String(request.channel)}`,
  };
}
