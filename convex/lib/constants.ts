// Shared vocabulary for the backend and the UI. Kept free of Convex server
// imports so client components can import it too.

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITIONS = ["like_new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well used",
};

export const LOAN_STATUSES = [
  "pending",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_EVENT_TYPES = [
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.returned",
] as const;
export type LoanEventType = (typeof LOAN_EVENT_TYPES)[number];

// Kinds of activity n8n is allowed to write back. Anything else is rejected
// at the HTTP boundary by the mutation's argument validator.
export const ACTIVITY_KINDS = [
  "notification_sent",
  "reminder_sent",
  "reminder_failed",
  "workflow_failed",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const LIMITS = {
  toolName: { min: 2, max: 60 },
  description: { max: 280 },
  note: { max: 200 },
  maxLoanDays: 30,
} as const;
