import type { FastifyBaseLogger } from 'fastify';

/**
 * Delivery providers sit behind interfaces (plan §3.6). No vendor is chosen yet (decision D10),
 * so only console stubs exist. loadConfig() refuses them when NODE_ENV=production.
 */
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

export interface EmailProvider {
  sendInvitation(to: string, name: string, link: string): Promise<void>;
}

export interface Providers {
  sms: SmsProvider;
  email: EmailProvider;
  /** True for console stubs: the API may echo dev-only links/codes back to the caller. */
  devEcho: boolean;
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
    },
  };
}

/** In tests we capture what would have been sent. */
export function memoryProviders(): Providers & { sentOtps: Map<string, string>; sentInvites: Map<string, string> } {
  const sentOtps = new Map<string, string>();
  const sentInvites = new Map<string, string>();
  return {
    devEcho: true,
    sentOtps,
    sentInvites,
    sms: { sendOtp: async (phone, code) => void sentOtps.set(phone, code) },
    email: { sendInvitation: async (to, _name, link) => void sentInvites.set(to, link) },
  };
}
