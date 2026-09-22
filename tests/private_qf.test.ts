import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect, beforeEach } from "vitest";
import { PrivateQFSimulator, fixedBytes, identityCommitmentOf } from "./simulator.js";

setNetworkId("undeployed");

const ADMIN = fixedBytes("admin-secret");
const ROUND_1 = fixedBytes("round-1");
const PROJECT_ALPHA = fixedBytes("project-alpha");
const PROJECT_BETA = fixedBytes("project-beta");
const ALICE = fixedBytes("donor-alice-secret");
const BOB = fixedBytes("donor-bob-secret");
const EVE = fixedBytes("donor-eve-unregistered-secret");

describe("PrivateQF contract", () => {
  let sim: PrivateQFSimulator;

  beforeEach(() => {
    sim = new PrivateQFSimulator(ADMIN, ROUND_1);
    sim.registerIdentity(ADMIN, identityCommitmentOf(ALICE));
    sim.registerIdentity(ADMIN, identityCommitmentOf(BOB));
  });

  // --- circuit logic -------------------------------------------------------

  it("initializes public round state and identity registry deterministically", () => {
    const l = sim.getLedger();
    expect(l.roundId).toEqual(ROUND_1);
    expect(l.registeredIdentities).toEqual(2n);
    expect(l.donorCount.isEmpty()).toBe(true);
  });

  it("only the admin can register identities or start a new round", () => {
    expect(() => sim.registerIdentity(BOB, identityCommitmentOf(EVE))).toThrow();
    expect(() => sim.startNewRound(BOB, fixedBytes("round-2"))).toThrow();
  });

  it("rejects a contribution from an identity that was never registered", () => {
    expect(() => sim.contribute(EVE, PROJECT_ALPHA, 100n)).toThrow();
  });

  // --- state transitions -----------------------------------------------------

  it("records a valid contribution: nullifier spent, commitment stored, donor count incremented", () => {
    const before = sim.getLedger();
    expect(before.donorCount.member(PROJECT_ALPHA)).toBe(false);

    const after = sim.contribute(ALICE, PROJECT_ALPHA, 900n);

    expect(after.donorCount.member(PROJECT_ALPHA)).toBe(true);
    expect(after.donorCount.lookup(PROJECT_ALPHA)).toEqual(1n);
    expect(after.spentNullifiers.size()).toEqual(1n);
    expect(after.contributionCommitments.size()).toEqual(1n);
  });

  it("blocks the same identity from contributing twice to the same project in the same round (anti-Sybil)", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    expect(() => sim.contribute(ALICE, PROJECT_ALPHA, 1n)).toThrow();
    // still counted once, no matter how many times the same human tries
    expect(sim.getLedger().donorCount.lookup(PROJECT_ALPHA)).toEqual(1n);
  });

  it("lets one identity contribute to two different projects, and two identities contribute to one project", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    sim.contribute(ALICE, PROJECT_BETA, 400n);
    sim.contribute(BOB, PROJECT_ALPHA, 100n);

    const l = sim.getLedger();
    expect(l.donorCount.lookup(PROJECT_ALPHA)).toEqual(2n);
    expect(l.donorCount.lookup(PROJECT_BETA)).toEqual(1n);
  });

  it("a fresh round resets the Sybil-guard so the same identity can contribute again", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    expect(() => sim.contribute(ALICE, PROJECT_ALPHA, 900n)).toThrow();

    sim.startNewRound(ADMIN, fixedBytes("round-2"));
    // does not throw: new round, new nullifier domain
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    expect(sim.getLedger().donorCount.lookup(PROJECT_ALPHA)).toEqual(2n);
  });

  it("settlement folds sqrt-scaled weight into the public matching totals, and rejects a mismatched amount", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n); // sqrt(900) = 30
    sim.contribute(BOB, PROJECT_ALPHA, 400n); // sqrt(400) = 20

    expect(() => sim.settleContribution(ALICE, PROJECT_ALPHA, 901n)).toThrow();

    sim.settleContribution(ALICE, PROJECT_ALPHA, 900n);
    sim.settleContribution(BOB, PROJECT_ALPHA, 400n);

    const l = sim.getLedger();
    expect(l.settledWeightSum.lookup(PROJECT_ALPHA)).toEqual(50n); // (30 + 20)
    expect(l.settledTotal.lookup(PROJECT_ALPHA)).toEqual(1300n); // (900 + 400)
    expect(l.settledCount.lookup(PROJECT_ALPHA)).toEqual(2n);

    // The quadratic-funding match a grants committee would use: the square of
    // the summed square roots outstrips the sum of raw donations whenever
    // there is more than one donor — this is the whole point of QF, and it
    // is now backed by a Sybil-resistant donor count.
    const match = l.settledWeightSum.lookup(PROJECT_ALPHA) ** 2n;
    expect(match).toBeGreaterThan(l.settledTotal.lookup(PROJECT_ALPHA));
  });

  it("rejects settling the same contribution twice", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    sim.settleContribution(ALICE, PROJECT_ALPHA, 900n);
    expect(() => sim.settleContribution(ALICE, PROJECT_ALPHA, 900n)).toThrow();
  });

  // --- privacy: identity and amount never appear on the public ledger --------

  it("never exposes the donor's identity secret anywhere in the public ledger", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    sim.contribute(BOB, PROJECT_BETA, 400n);

    const l = sim.getLedger();
    const serialized = JSON.stringify(
      {
        admin: Array.from(l.admin),
        roundId: Array.from(l.roundId),
        nullifiers: Array.from(l.spentNullifiers).map(([k, v]) => [Array.from(k), v]),
        commitments: Array.from(l.contributionCommitments).map(([k, v]) => [Array.from(k), Array.from(v)]),
        donorCount: Array.from(l.donorCount).map(([k, v]) => [Array.from(k), v.toString()])
      },
      null,
      2
    );

    expect(serialized).not.toContain(Buffer.from(ALICE).toString("hex"));
    expect(serialized).not.toContain(Buffer.from(BOB).toString("hex"));
  });

  it("never records the raw donation amount before settlement — only a hiding commitment", () => {
    const after = sim.contribute(ALICE, PROJECT_ALPHA, 12345n);

    // At contribution time there is no field anywhere on the ledger holding
    // 12345 — only donorCount (a small integer count) and a 32-byte
    // commitment that is computationally hiding.
    expect(after.settledTotal.isEmpty()).toBe(true);
    expect(after.settledWeightSum.isEmpty()).toBe(true);

    const commitments = Array.from(after.contributionCommitments).map(([, v]) => v);
    expect(commitments).toHaveLength(1);
    // 32 random-looking bytes, not a small integer encoding of 12345
    expect(commitments[0]).toHaveLength(32);
  });

  it("two different donors contributing the identical amount produce unlinkable commitments", () => {
    sim.contribute(ALICE, PROJECT_ALPHA, 900n);
    sim.contribute(BOB, PROJECT_BETA, 900n);

    const l = sim.getLedger();
    const [aliceCommit, bobCommit] = Array.from(l.contributionCommitments).map(([, v]) => v);
    expect(Buffer.from(aliceCommit).toString("hex")).not.toEqual(Buffer.from(bobCommit).toString("hex"));
  });
});
