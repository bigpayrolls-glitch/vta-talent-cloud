import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import { ApiError } from './errors.js';

/**
 * Delivery providers sit behind interfaces (plan §3.6).
 * - SMS: Message Central VerifyNow (the account PF Mitra already uses), or a console stub on local/staging.
 * - Email: any SMTP mailbox (Zoho Mail), or a console stub on local/staging.
 * loadConfig() refuses the console stubs when NODE_ENV=production outside staging.
 */

/** Result of checking a code with a provider that makes and checks codes itself. */
export type OtpCheck = 'ok' | 'wrong' | 'expired' | 'limit';

export interface SmsProvider {
  /**
   * Sends a sign-in code. Providers that make their own code (VerifyNow) ignore `code` and return a reference;
   * the code is then checked with checkOtp(). Others send `code` as given and return nothing.
   */
  sendOtp(phone: string, code: string): Promise<{ ref: string } | void>;
  checkOtp?(ref: string, code: string): Promise<OtpCheck>;
}

export interface EmailProvider {
  sendInvitation(to: string, name: string, link: string): Promise<void>;
  /** Phase 8: someone registered an organisation; the link confirms their email and sets a password. */
  sendSignupConfirmation(to: string, name: string, link: string): Promise<void>;
  /** Phase 9: a link to choose a new password (30 minutes, once). */
  sendPasswordReset(to: string, name: string, link: string): Promise<void>;
}

export interface Providers {
  sms: SmsProvider;
  email: EmailProvider;
  /** True for console stubs: the API may echo dev-only links/codes back to the caller. */
  devEcho: boolean;
}

const smsUnavailable = () => new ApiError('UNAVAILABLE', 'We could not send the code right now. Please try again in a minute.');

/**
 * Message Central VerifyNow (https://www.messagecentral.com/product/verify-now/api-india), as used by PF Mitra.
 * VerifyNow makes the 6-digit code itself. The auth token is made from the customer ID and the account password,
 * kept for 30 minutes and renewed when rejected; a fixed token from the console may be given instead.
 */
export class VerifyNowSms implements SmsProvider {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly customerId: string,
    private readonly password: string | null,
    private readonly fixedToken: string | null,
    private readonly log: FastifyBaseLogger,
    private readonly http: typeof fetch = fetch,
    private readonly base = 'https://cpaas.messagecentral.com',
  ) {}

  private async authToken(force: boolean): Promise<string> {
    if (this.fixedToken && (!force || !this.password)) return this.fixedToken;
    if (!force && this.token && this.token.until > Date.now()) return this.token.value;
    if (!this.password) {
      this.log.error('VerifyNow: auth token rejected; replace VERIFYNOW_AUTH_TOKEN or set VERIFYNOW_KEY');
      throw smsUnavailable();
    }
    const url = new URL(`${this.base}/auth/v1/authentication/token`);
    url.searchParams.set('customerId', this.customerId);
    url.searchParams.set('key', Buffer.from(this.password).toString('base64'));
    url.searchParams.set('scope', 'NEW');
    url.searchParams.set('country', '91');
    const r = await this.http(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const body = (r ? await r.json().catch(() => null) : null) as { token?: string } | null;
    if (!r?.ok || !body?.token) {
      this.log.error({ status: r?.status }, 'VerifyNow: could not get an auth token (check VERIFYNOW_CUSTOMER_ID and VERIFYNOW_KEY)');
      throw smsUnavailable();
    }
    this.token = { value: body.token, until: Date.now() + 30 * 60_000 };
    return body.token;
  }

  private async call(path: string, params: Record<string, string>, method: 'GET' | 'POST') {
    const run = async (force: boolean) => {
      const url = new URL(`${this.base}${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return this.http(url, { method, headers: { authToken: await this.authToken(force) }, signal: AbortSignal.timeout(10_000) });
    };
    let r = await run(false).catch((e: unknown) => (e instanceof ApiError ? Promise.reject(e) : null));
    if (r?.status === 401 && this.password) r = await run(true).catch((e: unknown) => (e instanceof ApiError ? Promise.reject(e) : null));
    if (r?.status === 401) {
      this.log.error('VerifyNow: auth token rejected');
      throw smsUnavailable();
    }
    if (!r) throw smsUnavailable();
    const body = (await r.json().catch(() => null)) as { responseCode?: number | string; message?: string; data?: Record<string, unknown> | null } | null;
    return { status: r.status, body };
  }

  async sendOtp(phone: string): Promise<{ ref: string }> {
    const m = /^\+91(\d{10})$/.exec(phone);
    if (!m) throw new ApiError('VALIDATION_FAILED', 'Codes can only be sent to Indian mobile numbers.');
    const { status, body } = await this.call(
      '/verification/v3/send',
      { countryCode: '91', customerId: this.customerId, flowType: 'SMS', mobileNumber: m[1]!, otpLength: '6' },
      'POST',
    );
    const id = body?.data?.verificationId;
    if (status !== 200 || id == null) {
      this.log.warn({ status, code: body?.responseCode, msg: body?.message }, 'VerifyNow send failed');
      if (Number(body?.responseCode) === 800 || status === 429) throw new ApiError('RATE_LIMITED', 'Too many codes for this number. Try again later.');
      throw smsUnavailable();
    }
    return { ref: String(id) };
  }

  async checkOtp(ref: string, code: string): Promise<OtpCheck> {
    const { status, body } = await this.call('/verification/v3/validateOtp', { verificationId: ref, code, customerId: this.customerId }, 'GET');
    const rc = Number(body?.responseCode);
    if (status === 200 && body?.data?.verificationStatus === 'VERIFICATION_COMPLETED') return 'ok';
    if (rc === 702) return 'wrong';
    if (rc === 705 || rc === 703 || rc === 505) return 'expired';
    if (rc === 800) return 'limit';
    this.log.warn({ status, code: rc, msg: body?.message }, 'VerifyNow validate failed');
    throw smsUnavailable();
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One plain email: a greeting, a sentence, the link as a button and as text, and how long it lasts. */
function emailBody(name: string, lead: string, action: string, link: string, note: string) {
  const text = `Hello ${name},\n\n${lead}\n\n${action}: ${link}\n\n${note}\n\nAutoTalent Grid\nTrain. Connect. Employ.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1b1b1f;max-width:520px">
<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(lead)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#D7141C;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a></p>
<p style="font-size:13px;color:#555">Or open this link: <br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(note)}</p>
<p style="font-size:13px;color:#555">AutoTalent Grid · Train. Connect. Employ.</p></div>`;
  return { text, html };
}

/** Emails through an SMTP mailbox (for example Zoho Mail: smtp.zoho.in, port 465). */
export function smtpEmail(config: Pick<Config, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'EMAIL_FROM'>, log: FastifyBaseLogger): EmailProvider {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const from = config.EMAIL_FROM || `AutoTalent Grid <${config.SMTP_USER}>`;
  const send = async (to: string, subject: string, body: { text: string; html: string }) => {
    try {
      await transport.sendMail({ from, to, subject, ...body });
    } catch (e) {
      log.error({ err: (e as Error).message }, 'Email could not be sent (check SMTP settings)');
      throw new ApiError('UNAVAILABLE', 'We could not send the email right now. Please try again in a few minutes.');
    }
  };
  return {
    sendInvitation: (to, name, link) =>
      send(to, 'You have been invited to AutoTalent Grid', emailBody(name, 'You have been invited to AutoTalent Grid.', 'Accept the invitation', link, 'This link works once. If you did not expect it, you can ignore this email.')),
    sendSignupConfirmation: (to, name, link) =>
      send(to, 'Confirm your AutoTalent Grid account', emailBody(name, 'Thank you for registering with AutoTalent Grid. Confirm your email and choose a password.', 'Confirm and set password', link, 'This link works once. If you did not register, you can ignore this email.')),
    sendPasswordReset: (to, name, link) =>
      send(to, 'Choose a new AutoTalent Grid password', emailBody(name, 'Someone asked to reset the password for your AutoTalent Grid account.', 'Choose a new password', link, 'This link lasts 30 minutes and works once. If it was not you, ignore this email; your password stays the same.')),
  };
}

/** The providers named in the settings (console stubs unless real ones are configured). */
export function providersFor(config: Config, log: FastifyBaseLogger): Providers {
  const stub = consoleProviders(log);
  const sms =
    config.SMS_PROVIDER === 'verifynow'
      ? new VerifyNowSms(config.VERIFYNOW_CUSTOMER_ID!, config.VERIFYNOW_KEY ?? null, config.VERIFYNOW_AUTH_TOKEN ?? null, log)
      : stub.sms;
  const email = config.EMAIL_PROVIDER === 'smtp' ? smtpEmail(config, log) : stub.email;
  return { sms, email, devEcho: config.SMS_PROVIDER === 'console' && config.EMAIL_PROVIDER === 'console' };
}

export function consoleProviders(log: FastifyBaseLogger): Providers {
  return {
    devEcho: true,
    sms: {
      async sendOtp(phone, code) {
        // Development only. Masked phone in logs; the code is shown so you can sign in locally.
        log.warn({ phone: `${phone.slice(0, 5)}*****${phone.slice(-2)}` }, `[DEV SMS] OTP code: ${code}`);
      },
    },
    email: {
      async sendInvitation(_to, name, link) {
        log.warn(`[DEV EMAIL] Invitation for ${name}: ${link}`);
      },
      async sendSignupConfirmation(_to, name, link) {
        log.warn(`[DEV EMAIL] Confirm registration for ${name}: ${link}`);
      },
      async sendPasswordReset(_to, name, link) {
        log.warn(`[DEV EMAIL] Password reset for ${name}: ${link}`);
      },
    },
  };
}

/** In tests we capture what would have been sent. */
export function memoryProviders(): Providers & { sentOtps: Map<string, string>; sentInvites: Map<string, string>; sentResets: Map<string, string> } {
  const sentOtps = new Map<string, string>();
  const sentResets = new Map<string, string>();
  const sentInvites = new Map<string, string>();
  return {
    devEcho: true,
    sentOtps,
    sentInvites,
    sentResets,
    sms: { sendOtp: async (phone, code) => void sentOtps.set(phone, code) },
    email: {
      sendInvitation: async (to, _name, link) => void sentInvites.set(to, link),
      sendSignupConfirmation: async (to, _name, link) => void sentInvites.set(to, link),
      sendPasswordReset: async (to, _name, link) => void sentResets.set(to, link),
    },
  };
}
