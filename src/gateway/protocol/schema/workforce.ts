import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkforceInitParamsSchema = Type.Object(
  {
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const WorkforceStatusParamsSchema = Type.Object({}, { additionalProperties: false });

export const WorkforceRunsParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    query: Type.Optional(Type.String()),
    status: Type.Optional(
      Type.Union([
        Type.Literal("queued"),
        Type.Literal("running"),
        Type.Literal("ok"),
        Type.Literal("error"),
        Type.Literal("blocked"),
        Type.Literal("escalated"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export const WorkforceLedgerParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
  },
  { additionalProperties: false },
);

export const WorkforceDecisionsParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("resolved")])),
  },
  { additionalProperties: false },
);

export const WorkforceWorkspaceParamsSchema = Type.Object({}, { additionalProperties: false });

export const WorkforceActionParamsSchema = Type.Object(
  {
    seatId: NonEmptyString,
    action: NonEmptyString,
    source: Type.Optional(
      Type.Union([
        Type.Literal("chat"),
        Type.Literal("subagent"),
        Type.Literal("cron"),
        Type.Literal("workforce"),
      ]),
    ),
    actor: Type.Optional(Type.String()),
    requireWritebackReceipt: Type.Optional(Type.Boolean()),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const WorkforceDecisionResolveParamsSchema = Type.Object(
  {
    decisionId: NonEmptyString,
    resolution: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
    actor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkforceReplayParamsSchema = Type.Object(
  {
    runId: NonEmptyString,
    actor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkforceScheduleAddParamsSchema = Type.Object(
  {
    seatId: NonEmptyString,
    name: NonEmptyString,
    intervalMs: Type.Integer({ minimum: 60_000 }),
    action: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkforceSchedulesParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
  },
  { additionalProperties: false },
);

export const WorkforceTickParamsSchema = Type.Object(
  {
    actor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkforceAppfolioWritebackParamsSchema = Type.Object(
  {
    actor: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    artifact: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
