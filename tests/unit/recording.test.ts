import { describe, expect, it } from "vitest";
import { recordedTestDescription } from "../../packages/workspace/ui-server.js";
import type { RecordedAction } from "../../packages/workspace/vision-service.js";

describe("recorded test descriptions", () => {
  it("deduplicates navigation, preserves pacing, and verifies redirect destinations", () => {
    const actions: RecordedAction[] = [
      { type: "navigate", value: "http://localhost:32100/landing", timestamp: 0 },
      { type: "navigate", value: "http://localhost:32100/landing", timestamp: 10 },
      { type: "click", target: "Sign In", timestamp: 100 },
      { type: "navigate", value: "http://localhost:32100/login", timestamp: 900 },
      { type: "click", target: "Have a password? Sign in here.", timestamp: 1_000 },
      { type: "click", target: "you@example.com", timestamp: 1_100 },
      { type: "fill", target: "you@example.com", value: "{{username}}", timestamp: 1_200 },
      { type: "fill", target: "Password", value: "{{password}}", timestamp: 2_500 },
      { type: "click", target: "Sign In", timestamp: 4_000 },
      { type: "navigate", value: "http://localhost:32100/ideas", timestamp: 5_000 },
    ];

    const description = recordedTestDescription(actions);

    expect(description.match(/Navigate to/g)).toHaveLength(1);
    expect(description).not.toContain('Click "you@example.com"');
    expect(description).toContain('Enter the saved username or email in "you@example.com"');
    expect(description).toContain('Enter the saved password in "Password"');
    expect(description).toContain('verify the URL includes "/login"');
    expect(description).toContain('verify the URL includes "/ideas"');
    expect(description).toContain("Wait 1300ms for the page to settle");
  });
});
