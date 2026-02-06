# ProofOfSource

Prove deployed contracts are the same as the open source.

ProofOfSource compares verified contract files from Etherscan against a GitHub repository (optionally pinned to a commit).

## What It Does

1. Accepts a deployed contract address.
2. Pulls verified source files from Etherscan API V2 (Solidity `.sol` and Vyper `.vy`).
3. Shows file checkboxes with library shortcuts (`Uncheck OpenZeppelin`, `Uncheck /lib`, etc.).
4. Accepts a GitHub repository URL and optional commit hash.
5. Uses latest `main` commit when no hash is provided (falls back to default branch if needed).
6. Compares selected Etherscan files to repository files.
7. Shows pass/fail status and inline diffs for mismatches.

## Requirements

- Node.js 18+
- Etherscan API key (in UI or `ETHERSCAN_API_KEY` on server)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

- `ETHERSCAN_API_KEY`: default Etherscan API key (if set, frontend hides API key field)
- `ETHERSCAN_API_BASE`: override Etherscan API base URL (default: `https://api.etherscan.io/v2/api`)
- `GITHUB_TOKEN`: optional GitHub token for higher API rate limits

## Notes

- Comparison normalizes line endings (`CRLF` and `LF`) before equality checks.
- Matching prefers exact path, then basename, then contract-name fallback (declaration search).
- Etherscan calls include `chainid` (default `1`, Ethereum mainnet).
