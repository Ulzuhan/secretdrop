import { describe, expect, it } from "vitest";
import { describeHours, describeViews, elapsedFraction, formatRemaining, timeAgo } from "./time";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("formatRemaining", () => {
  it("dice expirado cuando ya pasó", () => {
    expect(formatRemaining(NOW - 1, NOW)).toBe("expired");
    expect(formatRemaining(NOW, NOW)).toBe("expired");
  });
  it("no redondea a cero minutos", () => {
    expect(formatRemaining(NOW + 30_000, NOW)).toBe("under a minute");
  });
  it("escala de minutos a días sin ceros de relleno", () => {
    expect(formatRemaining(NOW + 8 * MIN, NOW)).toBe("8m");
    expect(formatRemaining(NOW + 5 * HOUR + 12 * MIN, NOW)).toBe("5h 12m");
    expect(formatRemaining(NOW + 5 * HOUR, NOW)).toBe("5h");
    expect(formatRemaining(NOW + 24 * HOUR, NOW)).toBe("1d");
    expect(formatRemaining(NOW + 74 * HOUR + 59 * MIN, NOW)).toBe("3d 2h");
  });
});

describe("timeAgo", () => {
  it("nunca habla del futuro", () => {
    expect(timeAgo(NOW + HOUR, NOW)).toBe("just now");
  });
  it("escala", () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 4 * MIN, NOW)).toBe("4m ago");
    expect(timeAgo(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(timeAgo(NOW - 49 * HOUR, NOW)).toBe("2d ago");
  });
});

describe("elapsedFraction", () => {
  it("queda acotada entre 0 y 1", () => {
    expect(elapsedFraction(NOW, NOW + HOUR, NOW - HOUR)).toBe(0);
    expect(elapsedFraction(NOW, NOW + HOUR, NOW + 30 * MIN)).toBeCloseTo(0.5);
    expect(elapsedFraction(NOW, NOW + HOUR, NOW + 2 * HOUR)).toBe(1);
    expect(elapsedFraction(NOW, NOW, NOW)).toBe(1);
  });
});

describe("descripciones", () => {
  it("horas y días en singular y plural", () => {
    expect(describeHours(1)).toBe("1 hour");
    expect(describeHours(6)).toBe("6 hours");
    expect(describeHours(24)).toBe("1 day");
    expect(describeHours(72)).toBe("3 days");
  });
  it("vistas", () => {
    expect(describeViews(1)).toBe("the first view");
    expect(describeViews(3)).toBe("3 views");
  });
});
