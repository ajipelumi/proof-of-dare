import { it, expect } from "vitest";
import {
  uintCV,
  principalCV,
  stringAsciiCV,
  bufferCV,
  ClarityType,
} from "@stacks/transactions";
import { cvToString } from "@stacks/transactions";

const CONTRACT = "proof-of-dare";

function buff32(hex: string) {
  const clean = hex.replace(/^0x/, "").padEnd(64, "0").slice(0, 64);
  return bufferCV(Buffer.from(clean, "hex"));
}

it("create, accept, vote, resolve - completed wins", () => {
  // @ts-ignore - provided by environment
  const accounts: Map<string, string> = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet1 = accounts.get("wallet_1")!; // challenger
  const wallet2 = accounts.get("wallet_2")!; // challengee
  const voterA = accounts.get("wallet_3")!;
  const voterB = accounts.get("wallet_4")!;

  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet2),
      uintCV(1), // TYPE_DARE
      stringAsciiCV("Do 10 pushups"),
      uintCV(2_000_000),
    ],
    wallet1
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  receipt = simnet.callPublicFn(
    CONTRACT,
    "accept-challenge",
    [uintCV(1)],
    wallet2
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  receipt = simnet.callPublicFn(CONTRACT, "start-voting", [uintCV(1)], wallet1);
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  const nonceA = buff32("a1");
  const nonceB = buff32("b2");
  const commitA = simnet.callReadOnlyFn(
    CONTRACT,
    "make-commit",
    [uintCV(1), nonceA, principalCV(voterA)],
    deployer
  );
  const commitB = simnet.callReadOnlyFn(
    CONTRACT,
    "make-commit",
    [uintCV(1), nonceB, principalCV(voterB)],
    deployer
  );

  receipt = simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(1), commitA.result],
    voterA
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);
  receipt = simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(1), commitB.result],
    voterB
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  // Mine blocks to pass commit window (144) + 1 to enter reveal period
  simnet.mineEmptyBlock(145);

  receipt = simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(1), uintCV(1), nonceA],
    voterA
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);
  receipt = simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(1), uintCV(1), nonceB],
    voterB
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  for (let i = 0; i < 500; i++) {
    simnet.mineEmptyBlock();
  }

  receipt = simnet.callPublicFn(
    CONTRACT,
    "resolve-challenge",
    [uintCV(1)],
    deployer
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);
});

it("expired pending challenge can be refunded", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const wallet5 = accounts.get("wallet_5")!; // Use different wallets to avoid conflicts
  const wallet6 = accounts.get("wallet_6")!;

  // Create a new challenge - this should be challenge ID 2 since ID 1 was used in the first test
  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet6),
      uintCV(0), // TYPE_TRUTH
      stringAsciiCV("Is this a test?"),
      uintCV(1_000_000),
    ],
    wallet5
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  const challengeId = (receipt.result as any).value.value;

  for (let i = 0; i < 145; i++) {
    simnet.mineEmptyBlock();
  }

  receipt = simnet.callPublicFn(
    CONTRACT,
    "refund-expired-challenge",
    [uintCV(challengeId)],
    wallet5
  );
  expect(cvToString(receipt.result).startsWith("(ok ")).toBe(true);
});
