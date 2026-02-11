import { describe, expect, it } from "vitest";
import {
  AUTONOMY_MODES,
  QUEUE_SEATS,
  REQUIRED_SEAT_IDS,
  SCHEDULER_SEEDS,
  UI_SEATS,
  WORKFORCE_ROSTER,
} from "./roster.js";

describe("workforce roster", () => {
  it("contains every required seat id exactly once", () => {
    const counts = new Map<string, number>();
    for (const seat of WORKFORCE_ROSTER) {
      counts.set(seat.id, (counts.get(seat.id) ?? 0) + 1);
    }

    expect(counts.size).toBe(REQUIRED_SEAT_IDS.length);
    for (const seatId of REQUIRED_SEAT_IDS) {
      expect(counts.get(seatId)).toBe(1);
    }
  });

  it("uses only the three supported autonomy modes", () => {
    const rosterModes = new Set(WORKFORCE_ROSTER.map((seat) => seat.autonomyMode));

    expect(rosterModes).toEqual(new Set(AUTONOMY_MODES));
    expect(rosterModes.size).toBe(3);
  });

  it("defines non-empty schedules, permissions, and systems access", () => {
    for (const seat of WORKFORCE_ROSTER) {
      expect(seat.permissions.length).toBeGreaterThan(0);
      expect(seat.systemsAccess.length).toBeGreaterThan(0);
      expect(seat.defaultSchedule.timezone).toBeTruthy();
      expect(seat.defaultSchedule.windows.length).toBeGreaterThan(0);
    }
  });

  it("derives queue, scheduler, and ui data from the roster", () => {
    const rosterIds = WORKFORCE_ROSTER.map((seat) => seat.id);

    expect(QUEUE_SEATS.map((seat) => seat.id)).toEqual(rosterIds);
    expect(SCHEDULER_SEEDS.map((seat) => seat.id)).toEqual(rosterIds);
    expect(UI_SEATS.map((seat) => seat.id)).toEqual(rosterIds);
  });
});
