import {
  type WitnessContext,
  persistentHash,
  CompactTypeBytes,
  CompactTypeVector
} from "@midnight-ntwrk/compact-runtime";
import type { Ledger, Witnesses } from "../managed/private_qf/contract/index.js";

// Private, client-side-only state. None of this is ever transmitted to the
// chain or appears in the public ledger — it only lives inside the donor's
// (or admin's) own machine/wallet.
export type PrivateQFPrivateState = {
  readonly identitySecret: Uint8Array;
  readonly adminSecret: Uint8Array;
};

export const createPrivateQFPrivateState = (
  identitySecret: Uint8Array,
  adminSecret: Uint8Array = new Uint8Array(32)
): PrivateQFPrivateState => ({ identitySecret, adminSecret });

const bytes32 = new CompactTypeBytes(32);
const pairOfBytes32 = new CompactTypeVector(2, bytes32);

// Same derivation the donor's client uses to hide a donation amount behind a
// commitment, and to re-open it later at settlement. It is deterministic in
// (identitySecret, projectId) so it never needs to be persisted anywhere.
const deriveBlinding = (identitySecret: Uint8Array, projectId: Uint8Array): Uint8Array =>
  persistentHash(pairOfBytes32, [identitySecret, projectId]);

// Verified, never trusted: this only ever hints at floor(sqrt(amount)); the
// circuit independently checks hint^2 <= amount < (hint+1)^2 before using it.
const integerSqrt = (amount: bigint): bigint => {
  if (amount < 2n) return amount;
  let x = amount;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + amount / x) / 2n;
  }
  return x;
};

export const witnesses: Witnesses<PrivateQFPrivateState> = {
  localAdminSecret: ({
    privateState
  }: WitnessContext<Ledger, PrivateQFPrivateState>): [PrivateQFPrivateState, Uint8Array] => [
    privateState,
    privateState.adminSecret
  ],

  localIdentitySecret: ({
    privateState
  }: WitnessContext<Ledger, PrivateQFPrivateState>): [PrivateQFPrivateState, Uint8Array] => [
    privateState,
    privateState.identitySecret
  ],

  localIdentityPath: ({ privateState, ledger }: WitnessContext<Ledger, PrivateQFPrivateState>) => {
    const leaf = persistentHash(bytes32, privateState.identitySecret);
    const path = ledger.identityTree.findPathForLeaf(leaf);
    if (path === undefined) {
      throw new Error(
        "PrivateQF: this identity is not registered in the eligible-donor tree yet"
      );
    }
    return [privateState, path];
  },

  localBlinding: (
    { privateState }: WitnessContext<Ledger, PrivateQFPrivateState>,
    projectId: Uint8Array
  ): [PrivateQFPrivateState, Uint8Array] => [
    privateState,
    deriveBlinding(privateState.identitySecret, projectId)
  ],

  localSqrtHint: (
    { privateState }: WitnessContext<Ledger, PrivateQFPrivateState>,
    amount: bigint
  ): [PrivateQFPrivateState, bigint] => [privateState, integerSqrt(amount)]
};
