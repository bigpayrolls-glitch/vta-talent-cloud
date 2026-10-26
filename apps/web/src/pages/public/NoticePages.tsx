import { NOTICE_VERSION } from '@vta/shared';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Wordmark } from '../../components/ui';

/**
 * The privacy notice and terms of use shown at registration and on first sign-in.
 * DRAFT wording for VTA's review: it describes what this software actually does, but it is not legal advice
 * and must be approved (and the contact details added) by VTA before the pilot starts.
 */
function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <header className="flex h-16 items-center border-b border-line px-4 lg:px-6">
        <Link to="/" aria-label="VTA Talent Cloud home">
          <Wordmark compact />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <p role="note" className="mb-6 flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Draft for VTA review (version {NOTICE_VERSION}). The final wording and contact details are to be approved by VTA before the pilot.
        </p>
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        <div className="notice mt-6 space-y-5 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      </main>
    </div>
  );
}

export function PrivacyNotice() {
  return (
    <>
      <p>VTA Talent Cloud helps you train, prove your skills and find work in the automotive sector. This notice explains what we keep about you and why.</p>
      <h2>What we keep</h2>
      <ul>
        <li>Your name, mobile number, date of birth and city (to create your account and confirm who you are).</li>
        <li>What you add to your profile: skills, experience, education, languages, availability, preferred work area, and any email address.</li>
        <li>Documents you upload, such as certificates or experience letters.</li>
        <li>Your training record: courses, attendance, assessment results and certificates.</li>
        <li>A record of sign-ins and important changes, for security.</li>
      </ul>
      <h2>Who can see it</h2>
      <ul>
        <li>VTA staff, to verify your profile and run the programme.</li>
        <li>Your training centre and trainer, for the batches you are in.</li>
        <li>Employers only if you choose: you can let employers find your profile, and you choose which documents they may see. You can change this at any time in Privacy.</li>
        <li>Anyone who scans a certificate&apos;s QR code sees only your name, the course, the issue date, the issuer and whether it is valid.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>See and correct your profile in the app. Once VTA has verified your name and date of birth, ask your training centre to correct them.</li>
        <li>Turn &ldquo;employers can find my profile&rdquo; on or off. Turning it off stops future sharing; it cannot recall what an employer has already seen.</li>
        <li>Ask VTA to close your account.</li>
      </ul>
      <h2>Contact</h2>
      <p>Contact details for privacy questions and complaints will be added here by VTA.</p>
    </>
  );
}

export function TermsOfUse() {
  return (
    <>
      <p>By creating an account you agree to:</p>
      <ul>
        <li>Give true information about yourself and upload only your own genuine documents.</li>
        <li>Keep your mobile number up to date; codes to sign in are sent to it.</li>
        <li>Not share your account or try to see other people&apos;s information.</li>
      </ul>
      <p>
        VTA certificates are records that you completed a VTA course and passed its assessment. They are not government, NSDC or ASDC qualifications. VTA does not promise
        a job or placement.
      </p>
      <p>VTA may suspend an account that breaks these terms.</p>
    </>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy notice">
      <PrivacyNotice />
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms of use">
      <TermsOfUse />
    </Shell>
  );
}
