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

it("rejects self-challenge and invalid stake/params", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;

  // Self-challenge should fail
  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet1),
      uintCV(1),
      stringAsciiCV("Self?"),
      uintCV(1_500_000),
    ],
    wallet1
  );
  expect(cvToString(receipt.result)).toContain("(err u111)");

  // Invalid stake (below MIN_STAKE) with different challengee to avoid self-challenge
  receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet2),
      uintCV(1),
      stringAsciiCV("bad stake"),
      uintCV(999_999),
    ],
    wallet1
  );
  expect(cvToString(receipt.result)).toContain("(err u101)");

  // Invalid type (not 0 or 1) -> uses ERR_INVALID_STAKE in contract
  receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet2),
      uintCV(9),
      stringAsciiCV("bad type"),
      uintCV(1_000_000),
    ],
    wallet1
  );
  expect(cvToString(receipt.result)).toContain("(err u101)");

  // Empty description -> ERR_INVALID_STAKE
  receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [principalCV(wallet2), uintCV(1), stringAsciiCV(""), uintCV(1_000_000)],
    wallet1
  );
  expect(cvToString(receipt.result)).toContain("(err u101)");
});

it("prevents unauthorized accept only", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const wallet5 = accounts.get("wallet_5")!; // challenger (fresh)
  const wallet6 = accounts.get("wallet_6")!; // intended challengee (fresh)
  const wallet3 = accounts.get("wallet_3")!; // unauthorized

  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet6),
      uintCV(1),
      stringAsciiCV("Do something"),
      uintCV(1_000_000),
    ],
    wallet5
  );
  const challengeId = (receipt.result as any).value.value;

  // Unauthorized accept by someone else
  receipt = simnet.callPublicFn(
    CONTRACT,
    "accept-challenge",
    [uintCV(challengeId)],
    wallet3
  );
  expect(cvToString(receipt.result)).toContain("(err u100)");
});

it("commit/reveal edge cases and double voting prevented", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  const voterA = accounts.get("wallet_3")!;

  // Setup: create, accept, start voting
  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet2),
      uintCV(0),
      stringAsciiCV("Truth?"),
      uintCV(1_500_000),
    ],
    wallet1
  );
  const id = (receipt.result as any).value.value;

  receipt = simnet.callPublicFn(
    CONTRACT,
    "accept-challenge",
    [uintCV(id)],
    wallet2
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  receipt = simnet.callPublicFn(
    CONTRACT,
    "start-voting",
    [uintCV(id)],
    wallet1
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  const nonceA = buff32("aa");
  const commitA = simnet.callReadOnlyFn(
    CONTRACT,
    "make-commit",
    [uintCV(1), nonceA, principalCV(voterA)],
    wallet1
  );

  // Challenger cannot commit
  receipt = simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(id), commitA.result],
    wallet1
  );
  expect(cvToString(receipt.result)).toContain("(err u100)");

  // Valid voter commits
  receipt = simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(id), commitA.result],
    voterA
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  // Double commit prevented
  receipt = simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(id), commitA.result],
    voterA
  );
  expect(cvToString(receipt.result)).toContain("(err u107)");

  // Mine to move into reveal window
  simnet.mineEmptyBlock(145);

  // Reveal with wrong nonce fails
  const wrongNonce = buff32("bb");
  receipt = simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(id), uintCV(1), wrongNonce],
    voterA
  );
  expect(cvToString(receipt.result)).toContain("(err u108)");

  // Reveal with correct nonce succeeds
  receipt = simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(id), uintCV(1), nonceA],
    voterA
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);

  // Double reveal prevented
  receipt = simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(id), uintCV(1), nonceA],
    voterA
  );
  expect(cvToString(receipt.result)).toContain("(err u107)");
});

it("cannot resolve before window end and handles ties", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet7 = accounts.get("wallet_7")!;
  const wallet8 = accounts.get("wallet_8")!;
  const voterA = accounts.get("wallet_3")!;
  const voterB = accounts.get("wallet_4")!;

  let receipt = simnet.callPublicFn(
    CONTRACT,
    "create-challenge",
    [
      principalCV(wallet8),
      uintCV(1),
      stringAsciiCV("Tie test"),
      uintCV(1_000_000),
    ],
    wallet7
  );
  const id = (receipt.result as any).value.value;

  simnet.callPublicFn(CONTRACT, "accept-challenge", [uintCV(id)], wallet8);
  simnet.callPublicFn(CONTRACT, "start-voting", [uintCV(id)], wallet7);

  const nonceA = buff32("11");
  const nonceB = buff32("22");

  const commitA = simnet.callReadOnlyFn(
    CONTRACT,
    "make-commit",
    [uintCV(1), nonceA, principalCV(voterA)],
    wallet7
  );
  const commitB = simnet.callReadOnlyFn(
    CONTRACT,
    "make-commit",
    [uintCV(2), nonceB, principalCV(voterB)],
    wallet7
  );

  simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(id), commitA.result],
    voterA
  );
  simnet.callPublicFn(
    CONTRACT,
    "commit-vote",
    [uintCV(id), commitB.result],
    voterB
  );

  simnet.mineEmptyBlock(145);

  simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(id), uintCV(1), nonceA],
    voterA
  );
  simnet.callPublicFn(
    CONTRACT,
    "reveal-vote",
    [uintCV(id), uintCV(2), nonceB],
    voterB
  );

  // Too early to resolve (still within reveal window)
  receipt = simnet.callPublicFn(
    CONTRACT,
    "resolve-challenge",
    [uintCV(id)],
    deployer
  );
  expect(cvToString(receipt.result)).toContain("(err u109)");

  // Mine well beyond reveal window total
  for (let i = 0; i < 500; i++) {
    simnet.mineEmptyBlock();
  }

  receipt = simnet.callPublicFn(
    CONTRACT,
    "resolve-challenge",
    [uintCV(id)],
    deployer
  );
  expect((receipt.result as any).type).toBe(ClarityType.ResponseOk);
});

it("reputation increases and mint-reputation-badge works with threshold", () => {
  // @ts-ignore
  const accounts: Map<string, string> = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  const voterA = accounts.get("wallet_3")!;
  const voterB = accounts.get("wallet_4")!;

  // Create multiple interactions to accumulate reputation for wallet2 (challengee)
  for (let i = 0; i < 3; i++) {
    let receipt = simnet.callPublicFn(
      CONTRACT,
      "create-challenge",
      [
        principalCV(wallet2),
        uintCV(1),
        stringAsciiCV(`Rep test ${i}`),
        uintCV(1_000_000),
      ],
      wallet1
    );
    const id = (receipt.result as any).value.value;

    simnet.callPublicFn(CONTRACT, "accept-challenge", [uintCV(id)], wallet2);
    simnet.callPublicFn(CONTRACT, "start-voting", [uintCV(id)], wallet1);

    const nonceA = buff32("aa" + i);
    const nonceB = buff32("bb" + i);

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

    simnet.callPublicFn(
      CONTRACT,
      "commit-vote",
      [uintCV(id), commitA.result],
      voterA
    );
    simnet.callPublicFn(
      CONTRACT,
      "commit-vote",
      [uintCV(id), commitB.result],
      voterB
    );

    simnet.mineEmptyBlock(145);

    simnet.callPublicFn(
      CONTRACT,
      "reveal-vote",
      [uintCV(id), uintCV(1), nonceA],
      voterA
    );
    simnet.callPublicFn(
      CONTRACT,
      "reveal-vote",
      [uintCV(id), uintCV(1), nonceB],
      voterB
    );

    // Ensure beyond commit+reveal windows
    for (let k = 0; k < 500; k++) {
      simnet.mineEmptyBlock();
    }

    simnet.callPublicFn(CONTRACT, "resolve-challenge", [uintCV(id)], deployer);
  }

  // Now wallet2 should have gained reputation from two wins (u50 each) => >= u100
  const badge = simnet.callPublicFn(
    CONTRACT,
    "mint-reputation-badge",
    [principalCV(wallet2)],
    wallet2
  );
  expect((badge.result as any).type).toBe(ClarityType.ResponseOk);
});
