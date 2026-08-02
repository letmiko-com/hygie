// Minimal ambient types for nodemailer (the package ships no .d.ts and adding
// @types/nodemailer is out of the allowed dependency set). Only what Hygie uses:
// createTransport + sendMail with SMTP or jsonTransport options.
declare module 'nodemailer' {
  export interface SentMessageInfo {
    messageId?: string;
    /** jsonTransport: the whole message serialized as a JSON string. */
    message?: string;
    accepted?: unknown[];
    rejected?: unknown[];
    pending?: unknown[];
    response?: string;
  }

  export interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }

  export interface Transporter {
    sendMail(mail: SendMailOptions): Promise<SentMessageInfo>;
  }

  export interface SmtpTransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    requireTLS?: boolean;
    auth?: { user: string; pass: string };
  }

  export interface JsonTransportOptions {
    jsonTransport: true;
  }

  export function createTransport(
    options: SmtpTransportOptions | JsonTransportOptions
  ): Transporter;
}
