import { v, type Infer } from "convex/values";
import type {
  ActivityKind,
  Category,
  Condition,
  LoanEventType,
  LoanStatus,
} from "./constants";

// Written out literally (rather than mapped from the constants) so Convex can
// infer precise literal types. The assertions at the bottom fail to compile if
// a validator and its constant list ever drift apart.

export const vCategory = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("other"),
);

export const vCondition = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const vLoanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const vLoanEventType = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);

export const vActivityKind = v.union(
  v.literal("notification_sent"),
  v.literal("reminder_sent"),
  v.literal("reminder_failed"),
  v.literal("workflow_failed"),
);

export const vRole = v.union(v.literal("user"), v.literal("admin"));

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const drift: [
  Same<Infer<typeof vCategory>, Category>,
  Same<Infer<typeof vCondition>, Condition>,
  Same<Infer<typeof vLoanStatus>, LoanStatus>,
  Same<Infer<typeof vLoanEventType>, LoanEventType>,
  Same<Infer<typeof vActivityKind>, ActivityKind>,
] = [true, true, true, true, true];
void drift;
