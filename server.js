const express = require('express');
const path = require('path');
const JSZip = require('jszip');
const { createPatch } = require('diff');

const app = express();
const PORT = process.env.PORT || 3000;

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CHAIN_ID_REGEX = /^\d+$/;
const DEFAULT_CHAIN_ID = '1';

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (_req, res) => {
  const hasServerEtherscanKey = Boolean(String(process.env.ETHERSCAN_API_KEY || '').trim());
  return res.json({
    hasServerEtherscanKey
  });
});

function normalizePath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.(\/|\\)/, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeContent(content) {
  return String(content || '').replace(/\r\n/g, '\n');
}

function isKnownLibraryPath(filePath) {
  const value = normalizePath(filePath).toLowerCase();
  return value.includes('openzeppelin') || value.startsWith('@openzeppelin/');
}

function truncateDiff(diffText, maxLines = 260) {
  const lines = String(diffText || '').split('\n');
  if (lines.length <= maxLines) {
    return diffText;
  }

  return `${lines.slice(0, maxLines).join('\n')}\n... (diff truncated, showing first ${maxLines} lines)`;
}

function stripZipRoot(entryName) {
  const firstSlash = String(entryName || '').indexOf('/');
  if (firstSlash === -1) {
    return '';
  }

  return entryName.slice(firstSlash + 1);
}

function getGitHubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'proof-of-source'
  };

  const token = (process.env.GITHUB_TOKEN || '').trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body.slice(0, 400)}`);
  }

  return response.json();
}

function parseGitHubRepoUrl(repoUrl) {
  try {
    const parsedUrl = new URL(repoUrl);
    if (parsedUrl.hostname !== 'github.com' && parsedUrl.hostname !== 'www.github.com') {
      return null;
    }

    const segments = parsedUrl.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2);

    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1].replace(/\.git$/i, '')
    };
  } catch {
    return null;
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFilesFromParsedObject(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const toFileList = (objectLike) => {
    const output = [];
    for (const [sourcePath, sourceValue] of Object.entries(objectLike || {})) {
      let content;
      if (typeof sourceValue === 'string') {
        content = sourceValue;
      } else if (sourceValue && typeof sourceValue === 'object') {
        if (typeof sourceValue.content === 'string') {
          content = sourceValue.content;
        } else if (typeof sourceValue.source === 'string') {
          content = sourceValue.source;
        }
      }

      if (typeof content === 'string') {
        output.push({ path: sourcePath, content });
      }
    }

    return output;
  };

  if (parsed.sources && typeof parsed.sources === 'object') {
    return toFileList(parsed.sources);
  }

  const objectEntries = Object.entries(parsed);
  const likelySources = objectEntries.filter(([key]) => {
    const normalized = normalizePath(key);
    return normalized.endsWith('.sol') || normalized.startsWith('@') || normalized.includes('/');
  });

  if (likelySources.length > 0) {
    return toFileList(Object.fromEntries(likelySources));
  }

  return [];
}

function parseEtherscanFiles(sourceCode, contractName) {
  const trimmed = String(sourceCode || '').trim();
  if (!trimmed) {
    return [];
  }

  const queue = [trimmed];
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    queue.push(trimmed.slice(1, -1));
  }

  const seen = new Set();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);

    const parsed = tryParseJson(candidate);
    if (!parsed) {
      continue;
    }

    if (typeof parsed === 'string') {
      if (!seen.has(parsed)) {
        queue.push(parsed);
      }

      if (parsed.startsWith('{{') && parsed.endsWith('}}')) {
        queue.push(parsed.slice(1, -1));
      }
      continue;
    }

    const extracted = extractFilesFromParsedObject(parsed);
    if (extracted.length > 0) {
      const deduped = new Map();
      for (const item of extracted) {
        const normalized = normalizePath(item.path);
        if (!normalized || deduped.has(normalized)) {
          continue;
        }

        deduped.set(normalized, {
          path: normalized,
          content: normalizeContent(item.content)
        });
      }

      return Array.from(deduped.values());
    }

    if (typeof parsed.SourceCode === 'string' && !seen.has(parsed.SourceCode)) {
      queue.push(parsed.SourceCode);
    }
  }

  const fallbackName = contractName ? `${contractName}.sol` : 'Contract.sol';
  return [{ path: fallbackName, content: normalizeContent(trimmed) }];
}

async function fetchEtherscanSources(address, apiKey, chainId = DEFAULT_CHAIN_ID) {
  const key = String(apiKey || process.env.ETHERSCAN_API_KEY || '').trim();
  if (!key) {
    throw new Error('Missing Etherscan API key. Provide it in the UI or ETHERSCAN_API_KEY env var.');
  }

  const normalizedChainId = String(chainId || DEFAULT_CHAIN_ID).trim() || DEFAULT_CHAIN_ID;
  if (!CHAIN_ID_REGEX.test(normalizedChainId)) {
    throw new Error('Invalid chain ID. Provide a numeric chain ID such as 1 (Ethereum mainnet).');
  }

  const params = new URLSearchParams({
    chainid: normalizedChainId,
    module: 'contract',
    action: 'getsourcecode',
    address,
    apikey: key
  });

  const etherscanBaseUrl = process.env.ETHERSCAN_API_BASE || 'https://api.etherscan.io/v2/api';
  const response = await fetch(`${etherscanBaseUrl}?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Etherscan request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
    const message = typeof data.result === 'string' ? data.result : data.message || 'Unknown error';
    throw new Error(`Etherscan API error: ${message}`);
  }

  const contractResult = data.result[0];
  const contractName = String(contractResult.ContractName || 'Contract');
  const sourceCode = String(contractResult.SourceCode || '');

  if (!sourceCode.trim()) {
    throw new Error('No verified source code found for this address on Etherscan.');
  }

  const files = parseEtherscanFiles(sourceCode, contractName);
  if (files.length === 0) {
    throw new Error('Etherscan returned source code, but no files could be parsed.');
  }

  return { contractName, files };
}

async function resolveCommitSha(owner, repo, commitHash) {
  const headers = getGitHubHeaders();
  const ref = String(commitHash || '').trim();

  if (ref) {
    const commitData = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      { headers }
    );
    return commitData.sha;
  }

  try {
    const mainCommit = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/main`,
      { headers }
    );
    return mainCommit.sha;
  } catch {
    const repoData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, {
      headers
    });
    const defaultBranch = repoData.default_branch || 'main';

    const defaultCommit = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
      { headers }
    );

    return defaultCommit.sha;
  }
}

async function downloadRepoZip(owner, repo, sha) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${sha}`, {
    headers: getGitHubHeaders()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub zip download failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const zipBuffer = await response.arrayBuffer();
  return JSZip.loadAsync(zipBuffer);
}

function indexZipEntries(zip) {
  const pathToEntry = new Map();
  const basenameToPaths = new Map();

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }

    const stripped = stripZipRoot(entry.name);
    const normalized = normalizePath(stripped);
    if (!normalized) {
      continue;
    }

    pathToEntry.set(normalized, entry);

    const basename = path.basename(normalized).toLowerCase();
    if (!basenameToPaths.has(basename)) {
      basenameToPaths.set(basename, []);
    }
    basenameToPaths.get(basename).push(normalized);
  }

  return { pathToEntry, basenameToPaths };
}

async function getRepoContentByPath(repoPath, index, contentCache) {
  if (contentCache.has(repoPath)) {
    return contentCache.get(repoPath);
  }

  const entry = index.pathToEntry.get(repoPath);
  if (!entry) {
    return null;
  }

  const text = normalizeContent(await entry.async('string'));
  contentCache.set(repoPath, text);
  return text;
}

function buildUnifiedDiff(filePath, expected, actual) {
  const patch = createPatch(filePath, expected, actual, 'etherscan', 'github', {
    context: 3
  });
  return truncateDiff(patch);
}

async function compareEtherscanFile(etherscanFile, index, contentCache) {
  const normalizedPath = normalizePath(etherscanFile.path);
  const expected = normalizeContent(etherscanFile.content || '');

  const candidates = [];
  if (index.pathToEntry.has(normalizedPath)) {
    candidates.push(normalizedPath);
  }

  const basename = path.basename(normalizedPath).toLowerCase();
  const basenameCandidates = index.basenameToPaths.get(basename) || [];
  for (const candidate of basenameCandidates) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const candidatePath of candidates) {
    const repoContent = await getRepoContentByPath(candidatePath, index, contentCache);
    if (repoContent === expected) {
      return {
        path: etherscanFile.path,
        status: 'match',
        matchedPath: candidatePath,
        reason:
          candidatePath === normalizedPath
            ? 'Exact content and path match.'
            : 'Exact content match found at a different path.'
      };
    }
  }

  if (candidates.length === 0) {
    return {
      path: etherscanFile.path,
      status: 'mismatch',
      reason: 'No file with the same path or basename was found in the repository.',
      diff: ''
    };
  }

  const fallbackPath = candidates[0];
  const fallbackContent = await getRepoContentByPath(fallbackPath, index, contentCache);

  return {
    path: etherscanFile.path,
    status: 'mismatch',
    matchedPath: fallbackPath,
    reason:
      fallbackPath === normalizedPath
        ? 'File exists at the same path, but content differs.'
        : 'Closest file (same basename) differs in content.',
    diff: buildUnifiedDiff(normalizedPath, expected, fallbackContent || '')
  };
}

app.post('/api/etherscan/files', async (req, res) => {
  try {
    const address = String(req.body?.address || '').trim();
    const apiKey = String(req.body?.apiKey || '').trim();
    const chainId = String(req.body?.chainId || DEFAULT_CHAIN_ID).trim() || DEFAULT_CHAIN_ID;

    if (!ETH_ADDRESS_REGEX.test(address)) {
      return res.status(400).json({
        error: 'Invalid Ethereum contract address. Expected 0x followed by 40 hex chars.'
      });
    }

    if (!CHAIN_ID_REGEX.test(chainId)) {
      return res.status(400).json({
        error: 'Invalid chain ID. Expected a numeric value such as 1 for Ethereum mainnet.'
      });
    }

    const { contractName, files } = await fetchEtherscanSources(address, apiKey, chainId);

    const preparedFiles = files
      .map((file) => ({
        path: normalizePath(file.path),
        content: normalizeContent(file.content),
        isKnownLib: isKnownLibraryPath(file.path)
      }))
      .filter((file) => file.path && typeof file.content === 'string')
      .sort((a, b) => a.path.localeCompare(b.path));

    return res.json({
      contractName,
      chainId,
      fileCount: preparedFiles.length,
      files: preparedFiles
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to fetch source files from Etherscan.'
    });
  }
});

app.post('/api/verify', async (req, res) => {
  try {
    const repoUrl = String(req.body?.repoUrl || '').trim();
    const commitHash = String(req.body?.commitHash || '').trim();
    const selectedFiles = Array.isArray(req.body?.selectedFiles) ? req.body.selectedFiles : [];

    if (!repoUrl) {
      return res.status(400).json({ error: 'GitHub repo URL is required.' });
    }

    if (selectedFiles.length === 0) {
      return res.status(400).json({ error: 'Select at least one file before verification.' });
    }

    const parsedRepo = parseGitHubRepoUrl(repoUrl);
    if (!parsedRepo) {
      return res.status(400).json({
        error: 'Invalid GitHub URL. Example: https://github.com/owner/repo'
      });
    }

    const normalizedSelectedFiles = selectedFiles
      .filter((item) => item && typeof item.path === 'string')
      .map((item) => ({
        path: normalizePath(item.path),
        content: normalizeContent(item.content || '')
      }))
      .filter((item) => item.path);

    if (normalizedSelectedFiles.length === 0) {
      return res.status(400).json({
        error: 'No valid selected files were provided.'
      });
    }

    const commitSha = await resolveCommitSha(parsedRepo.owner, parsedRepo.repo, commitHash);
    const zip = await downloadRepoZip(parsedRepo.owner, parsedRepo.repo, commitSha);
    const index = indexZipEntries(zip);

    const contentCache = new Map();
    const fileResults = await Promise.all(
      normalizedSelectedFiles.map((file) => compareEtherscanFile(file, index, contentCache))
    );

    const mismatches = fileResults.filter((result) => result.status !== 'match');

    return res.json({
      ok: mismatches.length === 0,
      commitSha,
      totalCompared: fileResults.length,
      mismatchCount: mismatches.length,
      fileResults
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Verification failed.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Source verifier running on http://localhost:${PORT}`);
});
