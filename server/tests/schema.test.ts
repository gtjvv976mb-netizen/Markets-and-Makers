import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "sql/003_progression_contracts.sql");

describe("progression and economy schema", () => {
  it("contains the durable records required by the v1 economy", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of ["trade_contract", "daily_enterprise_progress", "procurement_quota", "economy_snapshot"]) {
      expect(sql).toContain(`create table if not exists ${table}`);
    }
    expect(sql).toContain("trade_contract_one_active_player_idx");
    expect(sql).toContain("command_id uuid unique");
    expect(sql).toContain("claim_command_id uuid unique");
    expect(sql).toContain("used_quantity >= 0 and used_quantity <= base_quantity");
  });

  it("keeps daily and contract rewards as budgeted transfers", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("buyer_account_id uuid not null references currency_account(id)");
    expect(sql).toContain("the daily dividend is a government-budget transfer, never currency issuance");
    expect(sql).not.toMatch(/create table[^;]*faucet/i);
  });
});
