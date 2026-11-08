import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Where prices may appear in Settings. The money surfaces' behaviour is the
 * component tests'; which file may sell, and which reads the payments experiment,
 * is a source rule: `src/features/payments/README.md`.
 */
describe("payments surfaces in Settings", () => {
  it("splits state from purchase, and puts every price on Plan", () => {
    const account = readFileSync("src/features/settings/main/AccountSettingsView.tsx", "utf8");
    const plan = readFileSync("src/features/settings/main/SeatsSettingsView.tsx", "utf8");
    // No catalogue price may appear beside the state it would change.
    expect(account).not.toContain("PersonalPlan");
    expect(account).not.toContain("resolvePersonalOffer");
    expect(plan).toContain("<PersonalPlan");
    // Linking runs one way: the nav is on screen, so Plan needs no way back.
    expect(account).toContain("onOpenBilling");
    expect(plan).not.toContain("onOpenAccount");
  });

  it("prices nothing while the payments experiment is off", () => {
    // Both money surfaces are render entries and both fork on the same read:
    // `src/features/payments/README.md`.
    for (const file of ["AccountSettingsView", "SeatsSettingsView"]) {
      const source = readFileSync(`src/features/settings/main/${file}.tsx`, "utf8");
      expect(source).toContain("usePaymentsExperience();");
      expect(source).toMatch(/if \(!payments\) return null;|const cloudPlan = payments && cloudEnabled;/);
    }
    // Nothing below them may render a price by reading the experiment itself.
    const purchase = readFileSync("src/features/settings/main/PersonalPlan.tsx", "utf8");
    expect(purchase).not.toContain("usePaymentsExperience");
  });
});
