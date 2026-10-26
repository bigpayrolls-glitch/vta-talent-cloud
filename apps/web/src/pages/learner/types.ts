import type { AttendanceStats } from './attendance';

export interface LearnerProfile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  candidateCode: string;
  city: string;
  state: string | null;
  preferredWorkArea: string | null;
  skillAreas: string[];
  experienceMonths: number;
  education: string | null;
  languages: string[];
  availability: string | null;
  searchable: boolean;
  verificationStatus: 'pending' | 'verified' | 'rejected' | 'needs_correction';
  verificationReason: string | null;
  identityLocked: boolean;
  consentRequired: boolean;
  completeness: { pct: number; missing: string[] };
}

export interface LearningItem {
  enrolmentId: string;
  enrolmentStatus: 'enrolled' | 'withdrawn' | 'completed' | 'not_completed';
  batch: { id: string; name: string; status: string; startDate: string; endDate: string };
  course: { title: string; skillArea: string };
  centre: { name: string; city: string | null };
  attendance: AttendanceStats & { sessionsHeld: number; thresholdPct: number; belowThreshold: boolean };
  assessment: { state: 'not_assessed' | 'in_review' | 'released'; outcome: 'pass' | 'fail' | null };
  credentialId: string | null;
}

export interface LearnerResult {
  enrolmentId: string;
  course: string;
  batch: string;
  centre: string;
  totalScore: number;
  maxScore: number;
  pct: number;
  passMarkPct: number;
  outcome: 'pass' | 'fail';
  feedback: string | null;
  releasedAt: string | null;
  criteria: { label: string; maxScore: number; required: boolean; score: number | null; outcome: 'pass' | 'fail' | 'not_assessed'; comment: string | null }[];
}

export interface LearnerCredential {
  id: string;
  typeLabel: string;
  course: string;
  holderName: string;
  issueDate: string;
  issuer: string;
  status: 'active' | 'revoked' | 'superseded';
  verifyPath: string;
  replacedBy: string | null;
}

export interface LearnerDocument {
  id: string;
  kind: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  reviewReason: string | null;
  scanStatus: string;
  visibility: 'private' | 'employers';
  uploadedBySelf: boolean;
  canDelete: boolean;
  createdAt: string;
}

export interface ConsentView {
  noticeVersion: string;
  consentRequired: boolean;
  current: { purpose: string; granted: boolean; noticeVersion: string | null; at: string }[];
  history: { id: string; purpose: 'privacy_notice' | 'terms' | 'profile_searchable'; granted: boolean; noticeVersion: string | null; source: string; at: string }[];
}
