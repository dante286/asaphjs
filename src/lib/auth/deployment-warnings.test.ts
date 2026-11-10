import { describe, expect, it } from "vitest";
import { deploymentWarnings } from "./deployment-warnings";

const prod = (over: Record<string, string | undefined>) =>
  ({ NODE_ENV: "production", ...over }) as unknown as NodeJS.ProcessEnv;

describe("deploymentWarnings", () => {
  it("says nothing outside production", () => {
    expect(deploymentWarnings({ NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("says nothing for an https origin, or plain http on this machine", () => {
    expect(deploymentWarnings(prod({ BETTER_AUTH_URL: "https://asaph.example.com" }))).toEqual([]);
    expect(deploymentWarnings(prod({ BETTER_AUTH_URL: "http://localhost:3000" }))).toEqual([]);
    expect(deploymentWarnings(prod({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }))).toEqual([]);
  });

  it("warns when it's missing, malformed, or plain http on a real host", () => {
    expect(deploymentWarnings(prod({}))[0]).toContain("BETTER_AUTH_URL is not set");
    expect(deploymentWarnings(prod({ BETTER_AUTH_URL: "asaph.example.com" }))[0]).toContain("isn't a URL");
    expect(deploymentWarnings(prod({ BETTER_AUTH_URL: "http://asaph.example.com" }))[0]).toContain(
      "cookies aren't marked Secure",
    );
  });
});
