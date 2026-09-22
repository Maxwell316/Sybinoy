import { Contract } from "../managed/private_qf/contract/index.js";
import type { PrivateQFPrivateState } from "../contracts/witnesses.js";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js/types";
import type { DeployedContract, FoundContract } from "@midnight-ntwrk/midnight-js/contracts";
import type { ProvableCircuitId } from "@midnight-ntwrk/compact-js";

export type PrivateQFCircuits = ProvableCircuitId<Contract<PrivateQFPrivateState>>;

export const PrivateQFPrivateStateId = "privateQFPrivateState";

export type PrivateQFProviders = MidnightProviders<
  PrivateQFCircuits,
  typeof PrivateQFPrivateStateId,
  PrivateQFPrivateState
>;

export type PrivateQFContract = Contract<PrivateQFPrivateState>;

export type DeployedPrivateQFContract = DeployedContract<PrivateQFContract> | FoundContract<PrivateQFContract>;
