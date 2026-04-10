import { describe, it, expect } from "vitest";
import { buildDatabaseUrl } from "../supabase";

describe("DATABASE_URL Builder", () => {
  it("standard URL construction", () => {
    const url = buildDatabaseUrl("ref123", "mypassword", "us-east-1");
    expect(url).toBe(
      "postgresql://postgres.ref123:mypassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
    );
  });

  it("password with special characters is URI-encoded", () => {
    const url = buildDatabaseUrl("ref123", "p@ss:w0rd/test", "us-east-1");
    expect(url).toContain("p%40ss%3Aw0rd%2Ftest");
    expect(url).not.toContain("p@ss:w0rd/test");
  });

  it("different regions", () => {
    const url = buildDatabaseUrl("abc", "pass", "eu-west-2");
    expect(url).toContain("aws-0-eu-west-2.pooler.supabase.com");
  });

  it("uses correct port constant", () => {
    const url = buildDatabaseUrl("ref", "pass", "us-east-1");
    expect(url).toContain(":6543/");
  });

  it("pgbouncer and connection_limit params", () => {
    const url = buildDatabaseUrl("ref", "pass", "us-east-1");
    expect(url).toContain("?pgbouncer=true&connection_limit=1");
  });
});
