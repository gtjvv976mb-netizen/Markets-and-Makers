import { describe, expect, it } from "vitest";
import wallet from "../src/wallet.ts?raw";
import main from "../src/main.ts?raw";

describe("signing in with any Solana wallet", () => {
  it("listens for wallets that announce themselves", () => {
    // Reading window.solana finds whichever extension won the race to claim it. Every
    // current wallet announces itself over the Wallet Standard instead.
    expect(wallet).toContain('"wallet-standard:register-wallet"');
    expect(wallet).toContain('"wallet-standard:app-ready"');
  });

  it("only offers a wallet that can actually sign the login", () => {
    // The login IS a signed message, so connect alone is not enough to be listed.
    expect(wallet).toContain('wallet.features["standard:connect"]');
    expect(wallet).toContain('wallet.features["solana:signMessage"]');
    expect(wallet).toContain("if (!connectFeature || !signFeature) return null;");
  });

  it("still finds wallets that only inject a global", () => {
    // Older builds and some in-app browsers never announce. Dropping them would sign
    // real players out.
    for (const name of ["Phantom", "Solflare", "Backpack", "Glow", "Exodus", "Coinbase Wallet", "Trust", "Magic Eden"]) {
      expect(wallet, `${name} missing from the legacy list`).toContain(`name: "${name}"`);
    }
  });

  it("does not name one wallet as the only way in", () => {
    // The old copy said "Install Phantom to link an account" on a page that takes any
    // Solana wallet.
    expect(wallet).not.toContain("Install Phantom");
  });

  it("lets the player choose when more than one answered", () => {
    expect(main).toContain("const wallets = availableWallets();");
    expect(main).toContain("wallets.length > 1");
    expect(main).toContain('data-action="gate-connect" data-wallet=');
    // and the choice must be recorded before signIn resolves a provider from it
    const handler = main.slice(main.indexOf('action === "gate-connect"'));
    expect(handler.slice(0, 400)).toContain("chooseWallet(button.dataset.wallet)");
  });

  it("remembers the choice across visits", () => {
    expect(wallet).toContain("markets-makers-wallet-choice");
    expect(wallet).toContain("export function chosenWalletId");
  });
});
