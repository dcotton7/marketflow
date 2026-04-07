import { sendTwilioSms } from "./providers/twilio";

export interface MessageSendRequest {
  channel: "sms";
  to: string;
  body: string;
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
    return sendTwilioSms({
      to: request.to,
      body: request.body,
      statusCallbackUrl: request.statusCallbackUrl,
    });
  }

  return {
    success: false,
    providerMessageId: null,
    errorMessage: `Unsupported message channel: ${String(request.channel)}`,
  };
}
