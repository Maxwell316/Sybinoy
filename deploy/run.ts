import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { persistentHash, CompactTypeBytes } from "@midnight-ntwrk/compact-runtime";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { deployContract } from "@midnight-ntwrk/midnight-js/contracts";
import { Contract } from "../managed/private_qf/contract/index.js";
import { createPrivateQFPrivateState, witnesses } from "../contracts/witnesses.js";
import { PreviewConfig, PreprodConfig, contractConfig, currentDir, type Config } from "./config.js";
import { PrivateQFPrivateStateId } from "./common-types.js";
import { buildFreshWallet, buildWalletAndWaitForFunds, configureProviders, withStatus } from "./wallet.js";

const bytes32 = new CompactTypeBytes(32);

const network = (process.argv[2] ?? process.env.NETWORK ?? "preview").toLowerCase();
const config: Config = network === "preprod" ? new PreprodConfig() : new PreviewConfig();

console.log(`\nDeploying PrivateQF to: ${network}\n`);

const compiledContract = CompiledContract.make("private_qf", Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath)
);

// Reuse an already-funded wallet via WALLET_SEED instead of generating (and
// having to re-fund) a brand new one on every run.
const reuseSeed = process.env.WALLET_SEED;
const { ctx: walletCtx, seed } = reuseSeed
  ? { ctx: await buildWalletAndWaitForFunds(config, reuseSeed), seed: reuseSeed }
  : await buildFreshWallet(config);

const providers = await withStatus("Configuring providers", () => configureProviders(walletCtx, config));

// This round's admin secret is generated fresh, right here, for this deploy.
// Only its hash goes on-chain; keep the secret (saved to deployment-record.json
// below) to call registerIdentity / startNewRound later.
const adminSecret = randomBytes(32);
const adminKeyHash = persistentHash(bytes32, adminSecret);
const initialRoundId = persistentHash(bytes32, Buffer.from(`privateqf:round:${Date.now()}`));

const deployed = await withStatus("Deploying PrivateQF contract", () =>
  deployContract(providers, {
    compiledContract,
    privateStateId: PrivateQFPrivateStateId,
    initialPrivateState: createPrivateQFPrivateState(new Uint8Array(32), adminSecret),
    args: [adminKeyHash, initialRoundId]
  })
);

const contractAddress = deployed.deployTxData.public.contractAddress;

console.log(`\nDeployed PrivateQF contract at:\n  ${contractAddress}\n`);

const record = {
  network,
  contractAddress,
  deployedAt: new Date().toISOString(),
  walletSeed: seed,
  adminSecretHex: adminSecret.toString("hex"),
  initialRoundIdHex: Buffer.from(initialRoundId).toString("hex")
};

const outDir = path.resolve(currentDir, "..", "deploy-records");
await mkdir(outDir, { recursive: true });
const outFile = path.resolve(outDir, `${network}-${Date.now()}.json`);
await writeFile(outFile, JSON.stringify(record, null, 2));

console.log(`Saved wallet seed + admin secret + contract address to:\n  ${outFile}`);
console.log(`This file is git-ignored — keep it safe, it is the only copy of your wallet seed.\n`);

await walletCtx.wallet.stop();
process.exit(0);
