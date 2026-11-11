export interface WorkspaceTrial {
  isTrial: boolean;
  totalDays: number;
  daysLeft: number;
  currentDay: number;
  isExpired: boolean;
  trialEndsAt: string;
  formattedExpiresAt: string;
}

export const DEFAULT_TRIAL_DAYS = 7;

/**
 * Calculates the workspace trial period.
 * All team members of an organization share the same workspace trial,
 * which starts on the date the workspace was created (organization.createdAt).
 */
export function calculateWorkspaceTrial(
  org?: { createdAt?: Date | string | null; plan?: string | null } | null,
  trialDays: number = DEFAULT_TRIAL_DAYS
): WorkspaceTrial {
  const createdDate = org?.createdAt ? new Date(org.createdAt) : new Date();
  const trialDurationMs = trialDays * 24 * 60 * 60 * 1000;
  const trialEndsAt = new Date(createdDate.getTime() + trialDurationMs);
  const now = new Date();

  const msLeft = trialEndsAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
  const isExpired = msLeft <= 0;

  // Day 1 of 7, Day 3 of 7, etc.
  const msElapsed = Math.max(0, now.getTime() - createdDate.getTime());
  const elapsedDays = Math.floor(msElapsed / (24 * 60 * 60 * 1000));
  const currentDay = Math.min(trialDays, Math.max(1, elapsedDays + 1));

  return {
    isTrial: true,
    totalDays: trialDays,
    daysLeft,
    currentDay,
    isExpired,
    trialEndsAt: trialEndsAt.toISOString(),
    formattedExpiresAt: trialEndsAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

