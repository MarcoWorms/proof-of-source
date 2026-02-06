const express = require('express');
const path = require('path');
const JSZip = require('jszip');
const { createPatch } = require('diff');

const app = express();
const PORT = process.env.PORT || 3000;

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CHAIN_ID_REGEX = /^\d+$/;
const DEFAULT_CHAIN_ID = '1';
const ETHERSCAN_MAX_REQUESTS_PER_SECOND = Math.max(
  1,
  Number.parseInt(process.env.ETHERSCAN_MAX_REQUESTS_PER_SECOND || '3', 10) || 3
);
const ETHERSCAN_MAX_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.ETHERSCAN_MAX_RETRIES || '3', 10) || 3
);
const ETHERSCAN_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.ETHERSCAN_RETRY_BASE_DELAY_MS || '1000', 10) || 1000
);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function makeEtherscanError(message, options = {}) {
  const error = new Error(String(message || 'Etherscan request failed.'));
  error.retriable = Boolean(options.retriable);

  const retryAfterMs = Number(options.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    error.retryAfterMs = retryAfterMs;
  }

  return error;
}

function parseRetryAfterMs(value) {
  if (value == null) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function isLikelyTransientEtherscanMessage(message) {
  const value = String(message || '').toLowerCase();
  if (!value) {
    return false;
  }

  return (
    value.includes('max rate limit reached') ||
    value.includes('rate limit') ||
    value.includes('too many requests') ||
    value.includes('temporarily unavailable') ||
    value.includes('timeout') ||
    value.includes('server busy') ||
    value.includes('query timeout') ||
    value.includes('try again later')
  );
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function buildRepoFileId(repoKey, repoPath) {
  return `${String(repoKey || '').trim()}::${normalizePath(repoPath)}`;
}

function parseRepoFileId(repoFileId) {
  const raw = String(repoFileId || '').trim();
  if (!raw) {
    return null;
  }

  const separatorIndex = raw.indexOf('::');
  if (separatorIndex <= 0) {
    return null;
  }

  const repoKey = raw.slice(0, separatorIndex);
  const repoPath = normalizePath(raw.slice(separatorIndex + 2));
  if (!repoKey || !repoPath) {
    return null;
  }

  return {
    repoKey,
    repoPath
  };
}

function normalizeContent(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/g, '');
}

function normalizeNameForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenizeNameForMatch(name) {
  const spaced = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

  if (!spaced) {
    return [];
  }

  return spaced.split(/\s+/).filter(Boolean);
}

function scoreNameSimilarity(hintName, candidateName) {
  const hintNorm = normalizeNameForMatch(hintName);
  const candidateNorm = normalizeNameForMatch(candidateName);
  if (!hintNorm || !candidateNorm) {
    return 0;
  }

  if (hintNorm === candidateNorm) {
    return 1200;
  }

  let score = 0;

  if (candidateNorm.startsWith(hintNorm)) {
    score += 760 - Math.min(260, candidateNorm.length - hintNorm.length);
  }
  if (hintNorm.startsWith(candidateNorm)) {
    score += 520 - Math.min(220, hintNorm.length - candidateNorm.length);
  }
  if (candidateNorm.includes(hintNorm) || hintNorm.includes(candidateNorm)) {
    score += 330 - Math.min(180, Math.abs(candidateNorm.length - hintNorm.length));
  }

  const hintTokens = tokenizeNameForMatch(hintName);
  const candidateTokens = tokenizeNameForMatch(candidateName);
  const candidateTokenSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of hintTokens) {
    if (candidateTokenSet.has(token)) {
      overlap += 1;
    }
  }
  score += overlap * 90;

  if (hintTokens[0] && candidateTokens[0] && hintTokens[0] === candidateTokens[0]) {
    score += 48;
  }

  score -= Math.abs(candidateNorm.length - hintNorm.length) * 4;
  return score;
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
  const rawInput = String(repoUrl || '').trim();
  if (!rawInput) {
    return null;
  }

  const finalize = (ownerRaw, repoRaw) => {
    const owner = String(ownerRaw || '').trim();
    const repo = String(repoRaw || '').replace(/\.git$/i, '').trim();
    if (!owner || !repo) {
      return null;
    }

    return { owner, repo };
  };

  try {
    const parsedUrl = new URL(rawInput);
    const host = parsedUrl.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
      return null;
    }

    const segments = parsedUrl.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2);

    if (segments.length < 2) {
      return null;
    }

    return finalize(segments[0], segments[1]);
  } catch {
    const stripped = rawInput
      .replace(/^https?:\/\//i, '')
      .replace(/^(www\.)?github\.com\//i, '')
      .split(/[?#]/)[0]
      .trim();

    const segments = stripped.split('/').filter(Boolean).slice(0, 2);
    if (segments.length < 2) {
      return null;
    }

    return finalize(segments[0], segments[1]);
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
    return (
      normalized.endsWith('.sol') ||
      normalized.endsWith('.vy') ||
      normalized.startsWith('@') ||
      normalized.includes('/')
    );
  });

  if (likelySources.length > 0) {
    return toFileList(Object.fromEntries(likelySources));
  }

  return [];
}

function inferSourceExtension(sourceCode, compilerType = '') {
  const compiler = String(compilerType || '').toLowerCase();
  if (compiler.includes('vyper')) {
    return '.vy';
  }

  const source = String(sourceCode || '');
  if (/^\s*#\s*@?version\b/im.test(source)) {
    return '.vy';
  }

  return '.sol';
}

function parseEtherscanFiles(sourceCode, contractName, compilerType = '') {
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

  const extension = inferSourceExtension(trimmed, compilerType);
  const fallbackName = contractName ? `${contractName}${extension}` : `Contract${extension}`;
  return [{ path: fallbackName, content: normalizeContent(trimmed) }];
}

async function fetchEtherscanSources(address, apiKey, chainId = DEFAULT_CHAIN_ID) {
  const key = String(apiKey || process.env.ETHERSCAN_API_KEY || '').trim();
  if (!key) {
    throw makeEtherscanError('Missing Etherscan API key. Provide it in the UI or ETHERSCAN_API_KEY env var.', {
      retriable: false
    });
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
    const retriable = [429, 500, 502, 503, 504].includes(response.status);
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    throw makeEtherscanError(`Etherscan request failed (${response.status}): ${body.slice(0, 300)}`, {
      retriable,
      retryAfterMs
    });
  }

  const data = await response.json();
  if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
    const message = typeof data.result === 'string' ? data.result : data.message || 'Unknown error';
    throw makeEtherscanError(`Etherscan API error: ${message}`, {
      retriable: isLikelyTransientEtherscanMessage(`${data.message || ''} ${message}`)
    });
  }

  const contractResult = data.result[0];
  const contractName = String(contractResult.ContractName || 'Contract');
  const compilerType = String(contractResult.CompilerType || '');
  const sourceCode = String(contractResult.SourceCode || '');

  if (!sourceCode.trim()) {
    throw new Error('No verified source code found for this address on Etherscan.');
  }

  const files = parseEtherscanFiles(sourceCode, contractName, compilerType);
  if (files.length === 0) {
    throw new Error('Etherscan returned source code, but no files could be parsed.');
  }

  return { contractName, files };
}

function computeEtherscanRetryDelayMs(attemptNumber, error) {
  const retryAfterMs = Number(error?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return retryAfterMs;
  }

  const exponent = Math.max(0, Number(attemptNumber) - 1);
  const backoff = ETHERSCAN_RETRY_BASE_DELAY_MS * 2 ** exponent;
  const jitter = Math.floor(Math.random() * 250);
  return backoff + jitter;
}

async function fetchEtherscanSourcesWithRetry(address, apiKey, chainId = DEFAULT_CHAIN_ID) {
  let attempt = 0;
  const maxAttempts = ETHERSCAN_MAX_RETRIES + 1;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fetchEtherscanSources(address, apiKey, chainId);
    } catch (error) {
      const retriable = Boolean(error?.retriable);
      if (!retriable || attempt >= maxAttempts) {
        if (attempt > 1 && retriable) {
          throw new Error(`${error.message} (after ${attempt} attempts)`);
        }

        throw error;
      }

      const delayMs = computeEtherscanRetryDelayMs(attempt, error);
      await sleep(delayMs);
    }
  }

  throw new Error('Etherscan retry loop exhausted.');
}

async function fetchEtherscanBatchWithRateLimit(addresses, apiKey, chainId = DEFAULT_CHAIN_ID) {
  const results = [];
  const batchSize = ETHERSCAN_MAX_REQUESTS_PER_SECOND;

  for (let start = 0; start < addresses.length; start += batchSize) {
    const batch = addresses.slice(start, start + batchSize);
    const batchStartedAt = Date.now();

    const batchResults = await Promise.all(
      batch.map(async (address) => {
        try {
          const result = await fetchEtherscanSourcesWithRetry(address, apiKey, chainId);
          return {
            address,
            result
          };
        } catch (error) {
          throw new Error(`[${address}] ${error.message || 'Failed to fetch source files from Etherscan.'}`);
        }
      })
    );
    results.push(...batchResults);

    if (start + batchSize < addresses.length) {
      const elapsedMs = Date.now() - batchStartedAt;
      if (elapsedMs < 1000) {
        await sleep(1000 - elapsedMs);
      }
    }
  }

  return results;
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
  const stemToPaths = new Map();
  const addMapping = (map, key, value) => {
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    if (!map.get(key).includes(value)) {
      map.get(key).push(value);
    }
  };

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
    addMapping(basenameToPaths, basename, normalized);
    addMapping(basenameToPaths, normalizeNameForMatch(basename), normalized);

    const stem = path.basename(normalized, path.extname(normalized)).toLowerCase();
    if (stem) {
      addMapping(stemToPaths, stem, normalized);
      addMapping(stemToPaths, normalizeNameForMatch(stem), normalized);
    }
  }

  return {
    pathToEntry,
    basenameToPaths,
    stemToPaths,
    declaredNameToPaths: null
  };
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

function extractDeclaredEntityNames(source) {
  const content = String(source || '');
  const names = new Set();
  const patterns = [
    /\b(?:abstract\s+)?contract\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\blibrary\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\b/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      names.add(String(match[1]).toLowerCase());
    }
  }

  return Array.from(names);
}

function extractContractNameHints(filePath, source) {
  const hints = new Set();
  const normalizedPath = normalizePath(filePath);
  const stem = path.basename(normalizedPath, path.extname(normalizedPath)).toLowerCase();
  if (stem) {
    hints.add(stem);
  }

  const declaredNames = extractDeclaredEntityNames(source);
  for (const name of declaredNames) {
    hints.add(name);
  }

  return Array.from(hints);
}

async function getDeclaredNameIndex(index, contentCache) {
  if (index.declaredNameToPaths) {
    return index.declaredNameToPaths;
  }

  const declaredNameToPaths = new Map();
  const sourceLikePaths = Array.from(index.pathToEntry.keys()).filter((repoPath) =>
    /\.(sol|vy)$/i.test(repoPath)
  );

  for (const repoPath of sourceLikePaths) {
    const content = await getRepoContentByPath(repoPath, index, contentCache);
    if (!content) {
      continue;
    }

    const declaredNames = extractDeclaredEntityNames(content);
    for (const name of declaredNames) {
      const keys = [name, normalizeNameForMatch(name)];
      for (const key of keys) {
        if (!key) {
          continue;
        }
        if (!declaredNameToPaths.has(key)) {
          declaredNameToPaths.set(key, []);
        }
        if (!declaredNameToPaths.get(key).includes(repoPath)) {
          declaredNameToPaths.get(key).push(repoPath);
        }
      }
    }
  }

  index.declaredNameToPaths = declaredNameToPaths;
  return declaredNameToPaths;
}

function scoreCandidatePath(candidatePath, preferredPath, sourcePath, nameHints) {
  const normalizedCandidate = normalizePath(candidatePath);
  const normalizedPreferred = normalizePath(preferredPath);
  const normalizedSourcePath = normalizePath(sourcePath);
  const sourceBasename = path.basename(normalizedSourcePath).toLowerCase();
  const hintList = Array.isArray(nameHints) ? nameHints.filter(Boolean) : [];

  const candidateBasename = path.basename(normalizedCandidate).toLowerCase();
  const candidateStem = path.basename(normalizedCandidate, path.extname(normalizedCandidate));

  let score = 0;
  if (normalizedPreferred && normalizedCandidate === normalizedPreferred) {
    score += 5000;
  }
  if (normalizedCandidate === normalizedSourcePath) {
    score += 2500;
  }
  if (candidateBasename === sourceBasename) {
    score += 1100;
  }

  let bestHintScore = 0;
  for (const hint of hintList) {
    bestHintScore = Math.max(bestHintScore, scoreNameSimilarity(hint, candidateStem));
  }
  score += bestHintScore;

  const compactSourceStem = normalizeNameForMatch(
    path.basename(normalizedSourcePath, path.extname(normalizedSourcePath))
  );
  const compactCandidateStem = normalizeNameForMatch(candidateStem);
  if (compactSourceStem && compactCandidateStem && compactCandidateStem === compactSourceStem) {
    score += 1400;
  }

  score -= normalizedCandidate.length * 0.01;
  return score;
}

function rankCandidatePaths(candidatePaths, preferredPath, sourcePath, nameHints) {
  const scored = candidatePaths.map((candidatePath) => ({
    path: normalizePath(candidatePath),
    score: scoreCandidatePath(candidatePath, preferredPath, sourcePath, nameHints)
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length;
    }
    return a.path.localeCompare(b.path);
  });

  return scored.map((item) => item.path);
}

function rankCandidateRecords(candidateRecords, preferredRepoFileId, sourcePath, nameHints) {
  const preferred = parseRepoFileId(preferredRepoFileId);

  const scored = candidateRecords.map((candidate) => {
    let score = scoreCandidatePath(candidate.path, preferred?.repoPath || '', sourcePath, nameHints);

    if (preferred && candidate.repoKey === preferred.repoKey) {
      score += 150;
      if (candidate.path === preferred.repoPath) {
        score += 5000;
      }
    }

    return {
      ...candidate,
      score
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length;
    }
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    return a.repoLabel.localeCompare(b.repoLabel);
  });

  return scored;
}

function createBaseResult(etherscanFile) {
  return {
    path: etherscanFile.path,
    sourceAddress: normalizeAddress(etherscanFile.sourceAddress),
    sourceContractName: String(etherscanFile.sourceContractName || '')
  };
}

async function compareEtherscanFileAcrossRepos(etherscanFile, repoContexts, repoContextByKey) {
  const base = createBaseResult(etherscanFile);
  const normalizedPath = normalizePath(etherscanFile.path);
  const expected = normalizeContent(etherscanFile.content || '');
  const preferredRepoFileId = String(etherscanFile.preferredRepoFileId || '').trim();
  const preferredRepoPath = normalizePath(etherscanFile.preferredRepoPath || '');

  if (preferredRepoFileId) {
    const parsedPreferred = parseRepoFileId(preferredRepoFileId);
    if (!parsedPreferred) {
      return {
        ...base,
        status: 'mismatch',
        matchedPath: '',
        matchedRepoFileId: preferredRepoFileId,
        reason: 'Manual repo file override format is invalid.',
        diff: ''
      };
    }

    const preferredContext = repoContextByKey.get(parsedPreferred.repoKey);
    if (!preferredContext || !preferredContext.index.pathToEntry.has(parsedPreferred.repoPath)) {
      return {
        ...base,
        status: 'mismatch',
        matchedPath: parsedPreferred.repoPath,
        matchedRepoKey: parsedPreferred.repoKey,
        matchedRepoLabel: preferredContext?.repoLabel || '',
        matchedRepoFileId: preferredRepoFileId,
        reason: 'Manual repo file override was provided but does not exist in loaded repositories.',
        diff: ''
      };
    }

    const preferredContent = await getRepoContentByPath(
      parsedPreferred.repoPath,
      preferredContext.index,
      preferredContext.contentCache
    );

    if (preferredContent === expected) {
      return {
        ...base,
        status: 'match',
        matchedPath: parsedPreferred.repoPath,
        matchedRepoKey: preferredContext.repoKey,
        matchedRepoLabel: preferredContext.repoLabel,
        matchedRepoFileId: preferredRepoFileId,
        reason: 'Exact content match using manual repo file override.'
      };
    }

    return {
      ...base,
      status: 'mismatch',
      matchedPath: parsedPreferred.repoPath,
      matchedRepoKey: preferredContext.repoKey,
      matchedRepoLabel: preferredContext.repoLabel,
      matchedRepoFileId: preferredRepoFileId,
      reason: 'Manual repo file override differs in content.',
      diff: buildUnifiedDiff(normalizedPath, expected, preferredContent || '')
    };
  }

  if (preferredRepoPath) {
    const preferredPathCandidates = [];

    for (const context of repoContexts) {
      if (context.index.pathToEntry.has(preferredRepoPath)) {
        preferredPathCandidates.push({
          id: buildRepoFileId(context.repoKey, preferredRepoPath),
          repoKey: context.repoKey,
          repoLabel: context.repoLabel,
          path: preferredRepoPath
        });
      }
    }

    if (preferredPathCandidates.length === 0) {
      return {
        ...base,
        status: 'mismatch',
        matchedPath: preferredRepoPath,
        matchedRepoFileId: '',
        reason: 'Manual repo path override was provided but does not exist in loaded repositories.',
        diff: ''
      };
    }

    for (const candidate of preferredPathCandidates) {
      const preferredContext = repoContextByKey.get(candidate.repoKey);
      const preferredContent = await getRepoContentByPath(
        candidate.path,
        preferredContext.index,
        preferredContext.contentCache
      );

      if (preferredContent === expected) {
        return {
          ...base,
          status: 'match',
          matchedPath: candidate.path,
          matchedRepoKey: preferredContext.repoKey,
          matchedRepoLabel: preferredContext.repoLabel,
          matchedRepoFileId: candidate.id,
          reason: 'Exact content match using manual repo path override.'
        };
      }
    }

    const fallback = preferredPathCandidates[0];
    const fallbackContext = repoContextByKey.get(fallback.repoKey);
    const fallbackContent = await getRepoContentByPath(
      fallback.path,
      fallbackContext.index,
      fallbackContext.contentCache
    );

    return {
      ...base,
      status: 'mismatch',
      matchedPath: fallback.path,
      matchedRepoKey: fallbackContext.repoKey,
      matchedRepoLabel: fallbackContext.repoLabel,
      matchedRepoFileId: fallback.id,
      reason: 'Manual repo path override differs in content.',
      diff: buildUnifiedDiff(normalizedPath, expected, fallbackContent || '')
    };
  }

  const candidates = new Map();
  const pushCandidate = (context, candidatePath) => {
    const normalizedCandidate = normalizePath(candidatePath);
    if (!normalizedCandidate || !context.index.pathToEntry.has(normalizedCandidate)) {
      return;
    }

    const candidateId = buildRepoFileId(context.repoKey, normalizedCandidate);
    if (candidates.has(candidateId)) {
      return;
    }

    candidates.set(candidateId, {
      id: candidateId,
      repoKey: context.repoKey,
      repoLabel: context.repoLabel,
      path: normalizedCandidate
    });
  };

  const basename = path.basename(normalizedPath).toLowerCase();
  const nameHints = extractContractNameHints(normalizedPath, expected);
  if (etherscanFile.sourceContractName) {
    nameHints.push(String(etherscanFile.sourceContractName).toLowerCase());
  }

  for (const context of repoContexts) {
    pushCandidate(context, normalizedPath);

    const basenameCandidates = context.index.basenameToPaths.get(basename) || [];
    for (const candidate of basenameCandidates) {
      pushCandidate(context, candidate);
    }

    for (const hint of nameHints) {
      const normalizedHint = String(hint || '').toLowerCase();
      const compactHint = normalizeNameForMatch(hint);
      for (const hintKey of [normalizedHint, compactHint]) {
        if (!hintKey) {
          continue;
        }
        const stemCandidates = context.index.stemToPaths.get(hintKey) || [];
        for (const candidate of stemCandidates) {
          pushCandidate(context, candidate);
        }
      }
    }

    if (nameHints.length > 0) {
      const declaredNameIndex = await getDeclaredNameIndex(context.index, context.contentCache);
      for (const hint of nameHints) {
        const normalizedHint = String(hint || '').toLowerCase();
        const compactHint = normalizeNameForMatch(hint);
        for (const hintKey of [normalizedHint, compactHint]) {
          if (!hintKey) {
            continue;
          }
          const namedCandidates = declaredNameIndex.get(hintKey) || [];
          for (const candidate of namedCandidates) {
            pushCandidate(context, candidate);
          }
        }
      }
    }
  }

  const rankedCandidates = rankCandidateRecords(
    Array.from(candidates.values()),
    preferredRepoFileId,
    normalizedPath,
    nameHints
  );

  for (const candidate of rankedCandidates) {
    const candidateContext = repoContextByKey.get(candidate.repoKey);
    const repoContent = await getRepoContentByPath(
      candidate.path,
      candidateContext.index,
      candidateContext.contentCache
    );

    if (repoContent === expected) {
      return {
        ...base,
        status: 'match',
        matchedPath: candidate.path,
        matchedRepoKey: candidateContext.repoKey,
        matchedRepoLabel: candidateContext.repoLabel,
        matchedRepoFileId: candidate.id,
        reason:
          candidate.path === normalizedPath
            ? 'Exact content and path match.'
            : 'Exact content match found at a different path.'
      };
    }
  }

  if (rankedCandidates.length === 0) {
    return {
      ...base,
      status: 'mismatch',
      reason: 'No file matched by path, basename, or contract name in the loaded repositories.',
      diff: ''
    };
  }

  const fallback = rankedCandidates[0];
  const fallbackContext = repoContextByKey.get(fallback.repoKey);
  const fallbackContent = await getRepoContentByPath(
    fallback.path,
    fallbackContext.index,
    fallbackContext.contentCache
  );
  const fallbackBasename = path.basename(fallback.path).toLowerCase();
  const reasonSuffix = fallbackContext?.repoLabel ? ` in ${fallbackContext.repoLabel}.` : '.';

  return {
    ...base,
    status: 'mismatch',
    matchedPath: fallback.path,
    matchedRepoKey: fallbackContext?.repoKey || '',
    matchedRepoLabel: fallbackContext?.repoLabel || '',
    matchedRepoFileId: fallback.id,
    reason:
      fallback.path === normalizedPath
        ? `File exists at the same path, but content differs${reasonSuffix}`
        : fallbackBasename === basename
          ? `Closest file (same basename) differs in content${reasonSuffix}`
          : `Closest file (matched by contract name) differs in content${reasonSuffix}`,
    diff: buildUnifiedDiff(normalizedPath, expected, fallbackContent || '')
  };
}

app.post('/api/etherscan/files', async (req, res) => {
  try {
    const addressesInput = Array.isArray(req.body?.addresses)
      ? req.body.addresses
      : req.body?.address
        ? [req.body.address]
        : [];
    const apiKey = String(req.body?.apiKey || '').trim();
    const chainId = String(req.body?.chainId || DEFAULT_CHAIN_ID).trim() || DEFAULT_CHAIN_ID;

    const addresses = [];
    const seenAddresses = new Set();
    for (const rawAddress of addressesInput) {
      const normalized = String(rawAddress || '').trim();
      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      if (seenAddresses.has(key)) {
        continue;
      }

      seenAddresses.add(key);
      addresses.push(normalized);
    }

    if (addresses.length === 0) {
      return res.status(400).json({
        error: 'At least one Ethereum contract address is required.'
      });
    }

    const invalidAddress = addresses.find((address) => !ETH_ADDRESS_REGEX.test(address));
    if (invalidAddress) {
      return res.status(400).json({
        error: `Invalid Ethereum contract address: ${invalidAddress}. Expected 0x followed by 40 hex chars.`
      });
    }

    if (!CHAIN_ID_REGEX.test(chainId)) {
      return res.status(400).json({
        error: 'Invalid chain ID. Expected a numeric value such as 1 for Ethereum mainnet.'
      });
    }

    const addressSummaries = [];
    const preparedFiles = [];

    let fetchedAddresses;
    try {
      fetchedAddresses = await fetchEtherscanBatchWithRateLimit(addresses, apiKey, chainId);
    } catch (error) {
      const message = error?.message || 'Failed to fetch source files from Etherscan.';
      throw new Error(message);
    }

    for (const item of fetchedAddresses) {
      const address = item.address;
      const result = item.result;

      const normalizedAddress = normalizeAddress(address);
      const normalizedFiles = result.files
        .map((file) => ({
          path: normalizePath(file.path),
          content: normalizeContent(file.content),
          isKnownLib: isKnownLibraryPath(file.path),
          sourceAddress: normalizedAddress,
          sourceContractName: result.contractName
        }))
        .filter((file) => file.path && typeof file.content === 'string')
        .sort((a, b) => a.path.localeCompare(b.path));

      addressSummaries.push({
        address: normalizedAddress,
        contractName: result.contractName,
        fileCount: normalizedFiles.length
      });

      preparedFiles.push(...normalizedFiles);
    }

    preparedFiles.sort((a, b) => {
      const byAddress = a.sourceAddress.localeCompare(b.sourceAddress);
      if (byAddress !== 0) {
        return byAddress;
      }

      return a.path.localeCompare(b.path);
    });

    return res.json({
      chainId,
      addressCount: addressSummaries.length,
      fileCount: preparedFiles.length,
      addresses: addressSummaries,
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
    const reposInput = Array.isArray(req.body?.repos)
      ? req.body.repos
      : req.body?.repoUrl
        ? [{ repoUrl: req.body.repoUrl, commitHash: req.body.commitHash || '' }]
        : [];
    const selectedFiles = Array.isArray(req.body?.selectedFiles) ? req.body.selectedFiles : [];

    const repoEntries = [];
    const seenRepos = new Set();
    for (const item of reposInput) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const repoUrl = String(item.repoUrl || '').trim();
      const commitHash = String(item.commitHash || '').trim();
      if (!repoUrl) {
        continue;
      }

      const dedupeKey = `${repoUrl.toLowerCase()}::${commitHash.toLowerCase()}`;
      if (seenRepos.has(dedupeKey)) {
        continue;
      }

      seenRepos.add(dedupeKey);
      repoEntries.push({
        repoUrl,
        commitHash
      });
    }

    if (repoEntries.length === 0) {
      return res.status(400).json({ error: 'At least one GitHub repo URL is required.' });
    }

    if (selectedFiles.length === 0) {
      return res.status(400).json({ error: 'Select at least one file before verification.' });
    }

    const normalizedSelectedFiles = selectedFiles
      .filter((item) => item && typeof item.path === 'string')
      .map((item) => ({
        path: normalizePath(item.path),
        content: normalizeContent(item.content || ''),
        sourceAddress: normalizeAddress(item.sourceAddress || ''),
        sourceContractName: String(item.sourceContractName || ''),
        preferredRepoFileId: String(item.preferredRepoFileId || '').trim(),
        preferredRepoPath: normalizePath(item.preferredRepoPath || '')
      }))
      .filter((item) => item.path);

    if (normalizedSelectedFiles.length === 0) {
      return res.status(400).json({
        error: 'No valid selected files were provided.'
      });
    }

    const repoContexts = [];
    for (let i = 0; i < repoEntries.length; i += 1) {
      const repoEntry = repoEntries[i];
      const parsedRepo = parseGitHubRepoUrl(repoEntry.repoUrl);
      if (!parsedRepo) {
        return res.status(400).json({
          error: `Invalid GitHub repository: ${repoEntry.repoUrl}. Use owner/repo or https://github.com/owner/repo`
        });
      }

      const commitSha = await resolveCommitSha(parsedRepo.owner, parsedRepo.repo, repoEntry.commitHash);
      const zip = await downloadRepoZip(parsedRepo.owner, parsedRepo.repo, commitSha);
      const index = indexZipEntries(zip);
      const repoKey = `r${i + 1}`;
      const shortSha = commitSha.slice(0, 12);

      repoContexts.push({
        repoKey,
        repoLabel: `${parsedRepo.owner}/${parsedRepo.repo}@${shortSha}`,
        repoUrl: repoEntry.repoUrl,
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        commitSha,
        shortSha,
        index,
        contentCache: new Map()
      });
    }

    const repoContextByKey = new Map(repoContexts.map((context) => [context.repoKey, context]));

    const repoFiles = [];
    for (const context of repoContexts) {
      const repoPaths = Array.from(context.index.pathToEntry.keys()).sort((a, b) => a.localeCompare(b));
      for (const repoPath of repoPaths) {
        repoFiles.push({
          id: buildRepoFileId(context.repoKey, repoPath),
          repoKey: context.repoKey,
          repoLabel: context.repoLabel,
          path: repoPath,
          display: `[${context.repoLabel}] ${repoPath}`
        });
      }
    }

    const fileResults = await Promise.all(
      normalizedSelectedFiles.map((file) =>
        compareEtherscanFileAcrossRepos(file, repoContexts, repoContextByKey)
      )
    );

    const mismatches = fileResults.filter((result) => result.status !== 'match');
    const repoSummaries = repoContexts.map((context) => ({
      repoKey: context.repoKey,
      repoLabel: context.repoLabel,
      repoUrl: context.repoUrl,
      owner: context.owner,
      repo: context.repo,
      commitSha: context.commitSha,
      shortSha: context.shortSha
    }));

    return res.json({
      ok: mismatches.length === 0,
      commitSha: repoContexts.length === 1 ? repoContexts[0].commitSha : null,
      totalCompared: fileResults.length,
      mismatchCount: mismatches.length,
      fileResults,
      repoFiles,
      repoSummaries
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
