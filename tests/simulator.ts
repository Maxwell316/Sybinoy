import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  persistentHash,
  CompactTypeBytes
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Ledger, ledger } from "../managed/private_qf/contract/index.js";
import {
  type PrivateQFPrivateState,
  createPrivateQFPrivateState,
  witnesses
} from "../contracts/witnesses.js";

const bytes32 = new CompactTypeBytes(32);

export const zeroSecret = new Uint8Array(32);

// Deterministic 32-byte test fixture from a short label — not a real
// commitment scheme, just a convenient way to get distinct Bytes<32> values
// for donor secrets / project ids / round ids inside tests.
export const fixedBytes = (label: string): Uint8Array => {
  const out = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  out.set(encoded.subarray(0, 32));
  return out;
};

export const identityCommitmentOf = (secret: Uint8Array): Uint8Array => persistentHash(bytes32, secret);

export class PrivateQFSimulator {
  readonly contract: Contract<PrivateQFPrivateState>;
  circuitContext: CircuitContext<PrivateQFPrivateState>;

  constructor(adminSecret: Uint8Array, initialRoundId: Uint8Array) {
    this.contract = new Contract<PrivateQFPrivateState>(witnesses);
    const adminKeyHash = persistentHash(bytes32, adminSecret);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(createPrivateQFPrivateState(zeroSecret, adminSecret), "0".repeat(64)),
      adminKeyHash,
      initialRoundId
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  getPrivateState(): PrivateQFPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  // Every call below runs "as" whichever secret is supplied, by swapping the
  // circuit context's private state just for that call — this is what lets
  // one simulator instance stand in for many independent donor wallets all
  // talking to the same shared public contract state.
  private contextAs(identitySecret: Uint8Array, adminSecret?: Uint8Array): CircuitContext<PrivateQFPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState: {
        identitySecret,
        adminSecret: adminSecret ?? this.circuitContext.currentPrivateState.adminSecret
      }
    };
  }

  registerIdentity(adminSecret: Uint8Array, identityCommitment: Uint8Array): Ledger {
    const ctx = this.contextAs(zeroSecret, adminSecret);
    this.circuitContext = this.contract.impureCircuits.registerIdentity(ctx, identityCommitment).context;
    return this.getLedger();
  }

  startNewRound(adminSecret: Uint8Array, newRoundId: Uint8Array): Ledger {
    const ctx = this.contextAs(zeroSecret, adminSecret);
    this.circuitContext = this.contract.impureCircuits.startNewRound(ctx, newRoundId).context;
    return this.getLedger();
  }

  contribute(donorSecret: Uint8Array, projectId: Uint8Array, amount: bigint): Ledger {
    const ctx = this.contextAs(donorSecret);
    this.circuitContext = this.contract.impureCircuits.contribute(ctx, projectId, amount).context;
    return this.getLedger();
  }

  settleContribution(donorSecret: Uint8Array, projectId: Uint8Array, amount: bigint): Ledger {
    const ctx = this.contextAs(donorSecret);
    this.circuitContext = this.contract.impureCircuits.settleContribution(ctx, projectId, amount).context;
    return this.getLedger();
  }
}
