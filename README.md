# PrivateQF

> Sybil-resistant, privacy-preserving quadratic funding on Midnight — donor identity and donation amount stay private, but every contribution is cryptographically proven to come from a unique, verified human.

## Contract Address

| Network | Address |
|---------|---------|
| Preview | _not yet deployed_ |
| Preprod | _not yet deployed_ |

The contract compiles cleanly and is fully tested locally (see [Run Tests](#run-tests)), but has **not been deployed to a public testnet yet**. Deployment to Preview/Preprod requires a funded Midnight testnet wallet (tNight, via the [Preview](https://faucet.preview.midnight.network/) / [Preprod](https://faucet.preprod.midnight.network/) faucets) and the full `midnight-js` wallet/provider stack, which needs a real seed phrase the assistant building this repo does not have and should not generate on your behalf. See [Deploying](#deploying) below for exact next steps to fill this table in yourself.

## What This Does

Quadratic funding (the Gitcoin-grants model) matches donations using `(sum of sqrt(donation))²` instead of a simple sum, so many small donors count for more than one large donor — that's what's supposed to make it resistant to whales. In practice it's trivially gamed: because every donation is public, an attacker can split one donor's money across dozens of wallets ("sockpuppets") and collect a disproportionate matching bonus, since `sqrt` rewards donor *count* over donor *size*.

**PrivateQF** fixes the root cause instead of hiding the symptom. Every donor:

1. Registers once, off-chain, as a leaf in an on-chain Merkle tree of eligible identities (in production, gated by a proof-of-personhood/KYC provider — this contract enforces the cryptographic consequence, not the personhood check itself).
2. Contributes to a project by proving, in zero-knowledge, that they are *some* member of that tree — without revealing which one.
3. Has a **nullifier** deterministically derived from their private identity secret recorded on-chain. The same secret always produces the same nullifier for a given (round, project) pair, so the contract can reject a repeat contribution from the same human — even though it never learns who they are.

The result: an attacker can create as many wallets as they like, but every one of them still needs a *distinct, registered, unique-human* identity secret to pass the membership proof and post a new nullifier. Splitting one person's money across many wallets no longer creates many "donors" in the eyes of the quadratic-matching formula.

## Privacy Model

**PUBLIC (on-chain, visible to anyone):**
- The admin's key-hash and the current round id
- The Merkle **root** of the eligible-identity registry (not who is in it)
- How many identities have ever been registered (`registeredIdentities`)
- The set of spent nullifiers (proves *that* a valid, unique contribution happened — not *who* made it or *how much*)
- A hiding-and-binding commitment to each contribution's amount, keyed by nullifier (not by wallet or identity)
- Per-project donor *count* — this is meant to be public; it's the whole point of quadratic funding
- Per-project settled totals (`settledWeightSum`, `settledTotal`, `settledCount`) — populated only after a donor calls `settleContribution` to open their own commitment (see the limitation below)

**PRIVATE (private witness, never appears on the public ledger):**
- `identitySecret` — the donor's personal secret; only `persistentHash(identitySecret)` is ever registered publicly, as one anonymous leaf among many
- `identityPath` — the donor's own Merkle inclusion proof, used locally to build a ZK membership proof that reveals nothing about which leaf is theirs
- `donationAmount` — the raw pledge; only a commitment to it is written on-chain at contribution time
- `blinding` — randomness that makes the amount commitment hiding, derived deterministically so it never needs to be stored anywhere
- `adminSecret` — the round operator's key; used only to authorize `registerIdentity` / `startNewRound` locally, never sent anywhere

**What a donor proves without revealing anything else:**
1. *"I am one of the registered eligible identities"* — a zero-knowledge Merkle membership proof, without revealing which leaf is theirs.
2. *"I have not already contributed to this exact project in this round"* — enforced by nullifier non-reuse, without revealing the identity behind the nullifier.
3. *"I am pledging a specific amount I cannot later change"* — a binding commitment stands in for the raw amount on-chain.

**Known limitation (honest, not oversold):** computing the public `(sum of sqrt)²` match requires each donor's commitment to eventually be opened via `settleContribution`. At that point the amount *for that one nullifier* becomes visible on-chain — but the nullifier is cryptographically unlinkable to any wallet or identity, so what leaks is "contribution #7 was for 900 units," never "Alice donated 900 units." Closing this last gap fully (so amounts are never revealed, even at settlement) needs an aggregate ZK sum-of-square-roots proof or an MPC-based settlement step — that's out of scope for this Level 1 build and is the natural next milestone.

## Tech Stack

- [Midnight Network](https://midnight.network/) — ZK-enabled smart contract blockchain
- [Compact](https://docs.midnight.network/compact/writing) — Midnight's ZK circuit language (compiler `0.31.1`, language version `>= 0.16`)
- Node.js v22 (via `nvm`)
- Docker (for the local proof server)
- `@midnight-ntwrk/compact-runtime` for local circuit simulation/testing
- Vitest + TypeScript

## Prerequisites

- Node.js **v22** (`nvm install 22 && nvm use 22` — a `.nvmrc` is included)
- Docker Desktop, running
- The Compact toolchain (`compact` CLI) — installs a self-managed toolchain and pins a compiler version per-project
- `git`

## Setup

```bash
# 1. Install the Compact toolchain (CLI) if you don't have it
curl --proto '=https' --tlsv1.2 -sSf https://docs.midnight.network/install-compact.sh | sh
# (see https://docs.midnight.network for the current installer if this URL moves)

# 2. Use Node 22
nvm install 22 && nvm use 22

# 3. Install JS dependencies
npm install

# 4. Compile the contract (writes into managed/, which is git-ignored and regenerated)
npm run compact

# 5. Start the local proof server (only needed for real proving / deployment,
#    not for the unit tests below)
docker pull midnightnetwork/proof-server
docker run -d --name midnight-proof-server -p 6300:6300 midnightnetwork/proof-server
```

## Run Tests

```bash
npm test
# or, to recompile the contract first:
npm run test:compile
```

This runs the full Vitest suite (12 tests) directly against the compiled circuits via `@midnight-ntwrk/compact-runtime`'s in-process simulator — no wallet, node, indexer, or proof server required. It covers:

- **Circuit logic** — round/registry initialization, admin-only gating on `registerIdentity`/`startNewRound`, rejection of an unregistered identity.
- **State transitions** — a valid contribution updates `donorCount`/`spentNullifiers`/`contributionCommitments`; the *same* identity is blocked from contributing twice to the same project/round (the anti-Sybil property this whole project exists to demonstrate); one identity can still fund multiple different projects; a new round resets the nullifier domain; `settleContribution` folds a verified-sqrt weight into the public matching totals and rejects a mismatched amount or a double-settle.
- **Privacy** — the raw donor secret never appears anywhere in the serialized public ledger state; the raw donation amount is never present before settlement (only a 32-byte commitment); two donors contributing the identical amount produce unlinkable commitments.

## Deploying

Deploying to Preview/Preprod needs a funded Midnight wallet and the full `midnight-js` provider stack (wallet, indexer, node RPC, proof server, private-state storage). The most reliable way to do this today is to reuse the Midnight team's own reference CLI scaffolding rather than a hand-rolled script:

1. Clone [`midnightntwrk/example-counter`](https://github.com/midnightntwrk/example-counter) (or any current Midnight starter template) as a reference for `counter-cli/src/{config.ts,api.ts,cli.ts,common-types.ts}`.
2. Swap its `Counter` contract import for this repo's `managed/private_qf/contract` output and its `witnesses` for [`contracts/witnesses.ts`](contracts/witnesses.ts).
3. Fund a wallet from the [Preview faucet](https://faucet.preview.midnight.network/) or [Preprod faucet](https://faucet.preprod.midnight.network/).
4. Run the deploy flow, which will call `deployContract` with this contract's constructor args (`adminKeyHash`, `initialRoundId`) and print `deployTxData.public.contractAddress`.
5. Paste that address into the [Contract Address](#contract-address) table above.

## Initial Idea

_[LEAVE PLACEHOLDER — fill in manually]_

## Screenshots

_[LEAVE PLACEHOLDER — add compile output and contract address screenshots]_
