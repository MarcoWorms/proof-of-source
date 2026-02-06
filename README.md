# Etherscan vs GitHub Differ

This project helps users verify that smart contract source files verified on Etherscan match the exact files in a GitHub repository at a specific commit.

## What It Does

1. Accepts an Ethereum contract address.
2. Fetches verified source code from Etherscan API V2.
3. Displays all discovered contract/source files as checkboxes.
4. Unchecks OpenZeppelin files by default.
5. Accepts a GitHub repository URL and optional commit hash.
6. If no commit hash is provided, it uses the latest commit on the repo default branch.
7. Compares selected Etherscan files to GitHub files and reports:
   - Green success if all selected files match.
   - Red failure with per-file diffs where content differs.

## Requirements

- Node.js 18+
- Etherscan API key (either in UI input or `ETHERSCAN_API_KEY` env var)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Optional Environment Variables

- `ETHERSCAN_API_KEY`: default Etherscan API key
- `ETHERSCAN_API_BASE`: override Etherscan API base URL (defaults to `https://api.etherscan.io/v2/api`)
- `GITHUB_TOKEN`: GitHub token to increase API rate limits

## Notes

- The comparison normalizes line endings (`CRLF` vs `LF`) before checking equality.
- Matching strategy prefers exact path first, then falls back to files with the same basename.
- Etherscan calls include `chainid` (default `1` for Ethereum mainnet).
