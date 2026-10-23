export type ProviderType = 'smtp' | 'gmail_oauth' | 'resend' | 'ses';
export type MessageStatus = 'scheduled' | 'queued' | 'sending' | 'sent' | 'failed';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerified: boolean;
  hasPassword: boolean;
  plan: { code: string; name: string };
  limits: { daily: number; monthly: number; burst: number; aiDaily: number };
  usage: { day: number; month: number };
}

export interface Project {
  id: string;
  name: string;
  defaultProviderId: string | null;
  createdAt: string;
  _count?: { apiKeys: number; messages: number };
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  priority: number;
  fromEmail: string;
  fromName: string | null;
  dailyCap: number | null;
  ratePerSecond: number | null;
  healthy: boolean;
  consecutiveAuthFailures: number;
  lastError: string | null;
  lastUsedAt: string | null;
  config: Record<string, unknown>;
}

export interface Preset {
  id: string;
  name: string;
  type: ProviderType;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  dailyCap: number | null;
  helpUrl: string | null;
  notes: string | null;
  active: boolean;
  sortOrder: number;
}

export interface TemplateVersion {
  id: string;
  version: number;
  subject: string;
  format: 'mjml' | 'html';
  body: string;
  text: string | null;
  sampleData: Record<string, unknown> | null;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  projectId: string | null;
  layoutId: string | null;
  currentVersion: number;
  isGallery: boolean;
  updatedAt: string;
  versions: TemplateVersion[];
}

export interface Layout {
  id: string;
  name: string;
  format: 'mjml' | 'html';
  body: string;
  isSystem: boolean;
}

export interface MessageRow {
  id: string;
  projectId: string;
  to: string[];
  subject: string;
  status: MessageStatus;
  attempts: number;
  error: string | null;
  tags: string[];
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  provider: { id: string; name: string; type: ProviderType } | null;
  user?: { email: string };
}

export interface MessageDetail extends MessageRow {
  html: string;
  text: string | null;
  cc: string[];
  bcc: string[];
  providerMessageId: string | null;
  events: { id: string; type: string; detail: string | null; createdAt: string; provider?: { name: string } | null }[];
  template?: { id: string; name: string; slug: string } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  dailyLimit: number;
  monthlyLimit: number;
  burstPerSecond: number;
  aiDailyLimit: number;
  priceInr: number;
  razorpayPlanId: string | null;
  active?: boolean;
  sortOrder?: number;
  _count?: { users: number };
}

export interface UsageSeries {
  date: string;
  sent: number;
  failed: number;
}
