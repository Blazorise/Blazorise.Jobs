#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const DEFAULT_OUTPUT = path.join(process.cwd(), "public", "jobs.json");
const DEFAULT_SCHEMA = path.join(process.cwd(), "schema", "jobs.schema.json");

const EXPECTED_HEADINGS = new Map([
  ["company name", "company"],
  ["role title", "title"],
  ["location", "location"],
  ["remote", "remote"],
  ["employment type", "employmentType"],
  ["seniority", "seniority"],
  ["tags keywords", "tags"],
  ["apply url", "applyUrl"],
  ["description", "description"],
  ["salary range", "salaryRange"],
  ["contact email", "contactEmail"],
  ["expiry date", "expiryDate"],
  ["confirmation", "confirmation"]
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      args.repo = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output") {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--schema") {
      args.schema = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log("Usage: node scripts/build-jobs.js [--repo owner/repo] [--output path] [--schema path]");
}

function normalizeHeading(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (normalized === "_no response_" || normalized === "no response") {
    return "";
  }
  return trimmed;
}

function parseIssueForm(body) {
  const fields = {};
  if (!body) {
    return fields;
  }

  const lines = body.split(/\r?\n/);
  let currentKey = null;
  let buffer = [];

  const commit = () => {
    if (!currentKey) {
      return;
    }
    const raw = buffer.join("\n").trim();
    if (!(currentKey in fields)) {
      fields[currentKey] = normalizeValue(raw);
    }
  };

  for (const line of lines) {
    const headingMatch = /^#{2,6}\s+(.+?)\s*$/.exec(line.trim());
    if (headingMatch) {
      const normalized = normalizeHeading(headingMatch[1]);
      const key = EXPECTED_HEADINGS.get(normalized);
      if (key) {
        commit();
        currentKey = key;
        buffer = [];
        continue;
      }
    }
    if (currentKey) {
      buffer.push(line);
    }
  }

  commit();
  return fields;
}

function requireValue(value, label, errors) {
  if (!value) {
    errors.push(`${label} is required`);
    return "";
  }
  return value;
}

function parseTags(value, errors) {
  if (!value) {
    errors.push("Tags/keywords is required");
    return [];
  }
  const rawItems = value.split(",").map((item) => item.trim()).filter(Boolean);
  const seen = new Set();
  const tags = [];
  for (const item of rawItems) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(item);
    }
  }
  if (tags.length === 0) {
    errors.push("Tags/keywords must include at least one value");
  }
  return tags;
}

function parseRemote(value, errors) {
  if (!value) {
    errors.push("Remote is required");
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["yes", "y", "true"].includes(normalized)) {
    return true;
  }
  if (["no", "n", "false"].includes(normalized)) {
    return false;
  }
  errors.push(`Remote must be Yes or No (got "${value}")`);
  return null;
}

function parseApplyUrl(value, errors) {
  if (!value) {
    errors.push("Apply URL is required");
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push("Apply URL must start with http:// or https://");
      return null;
    }
    return value;
  } catch (err) {
    errors.push("Apply URL must be a valid URL");
    return null;
  }
}

function parseExpiryDate(value, errors) {
  if (!value) {
    errors.push("Expiry date is required");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push("Expiry date must be in YYYY-MM-DD format");
    return null;
  }
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push("Expiry date must be a valid calendar date");
    return null;
  }
  return value;
}

function parseConfirmation(value, errors) {
  if (!value) {
    errors.push("Confirmation checkbox is required");
    return false;
  }
  const checked = value
    .split(/\r?\n/)
    .some((line) => /^\s*-\s*\[[xX]\]/.test(line));
  if (!checked) {
    errors.push("Confirmation checkbox must be checked");
  }
  return checked;
}

function toIsoDate(value, label, errors) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push(`Issue ${label} is not a valid timestamp`);
    return null;
  }
  return date.toISOString();
}

function isExpired(expiryDate) {
  const todayUtc = new Date().toISOString().slice(0, 10);
  return expiryDate < todayUtc;
}

async function fetchApprovedIssues(owner, repo, token) {
  const issues = [];
  let page = 1;
  const perPage = 100;
  let hasNext = true;

  while (hasNext) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("labels", "type:job,status:approved");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "blazorise-jobs-bot",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    await handleRateLimit(response.headers);

    const data = await response.json();
    for (const issue of data) {
      if (!issue.pull_request) {
        issues.push(issue);
      }
    }

    const link = response.headers.get("link") || "";
    hasNext = link.includes('rel="next"');
    page += 1;
  }

  return issues;
}

async function handleRateLimit(headers) {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === "0" && reset) {
    const resetMs = Number(reset) * 1000;
    const delayMs = resetMs - Date.now();
    if (delayMs > 0) {
      console.log(`Rate limit reached, sleeping for ${Math.ceil(delayMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function buildJobs(issues) {
  const jobs = [];
  const invalidIssues = [];
  let expiredCount = 0;

  for (const issue of issues) {
    const errors = [];
    const fields = parseIssueForm(issue.body || "");

    const company = requireValue(fields.company, "Company name", errors);
    const title = requireValue(fields.title, "Role title", errors);
    const location = requireValue(fields.location, "Location", errors);
    const employmentType = requireValue(fields.employmentType, "Employment type", errors);
    const seniority = requireValue(fields.seniority, "Seniority", errors);
    const description = requireValue(fields.description, "Description", errors);
    const tags = parseTags(fields.tags, errors);
    const remote = parseRemote(fields.remote, errors);
    const applyUrl = parseApplyUrl(fields.applyUrl, errors);
    const expiryDate = parseExpiryDate(fields.expiryDate, errors);
    parseConfirmation(fields.confirmation, errors);

    const createdAt = toIsoDate(issue.created_at, "createdAt", errors);
    const updatedAt = toIsoDate(issue.updated_at, "updatedAt", errors);

    if (errors.length > 0) {
      invalidIssues.push({
        number: issue.number,
        title: issue.title,
        errors
      });
      continue;
    }

    if (isExpired(expiryDate)) {
      expiredCount += 1;
      continue;
    }

    jobs.push({
      id: issue.number,
      createdAt,
      updatedAt,
      title,
      company,
      location,
      remote,
      employmentType,
      seniority,
      tags,
      applyUrl,
      description,
      salaryRange: fields.salaryRange ? fields.salaryRange : null,
      expiryDate
    });
  }

  return { jobs, invalidIssues, expiredCount };
}

function validateSchema(schemaPath, data) {
  const schemaRaw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    const details = (validate.errors || [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`Schema validation failed: ${details}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const outputPath = path.resolve(process.cwd(), args.output || DEFAULT_OUTPUT);
  const schemaPath = path.resolve(process.cwd(), args.schema || DEFAULT_SCHEMA);

  if (!repo) {
    throw new Error("Repository is required via --repo or GITHUB_REPOSITORY");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid repo value: ${repo}`);
  }

  console.log(`Fetching approved job issues for ${owner}/${repoName}`);
  const issues = await fetchApprovedIssues(owner, repoName, token);
  console.log(`Fetched ${issues.length} approved issues`);

  const { jobs, invalidIssues, expiredCount } = buildJobs(issues);

  if (invalidIssues.length > 0) {
    const lines = invalidIssues.map((item) => {
      return `#${item.number} ${item.title}: ${item.errors.join("; ")}`;
    });
    throw new Error(`Invalid approved job issues:\n${lines.join("\n")}`);
  }

  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(jobs, null, 2) + "\n", "utf8");

  validateSchema(schemaPath, jobs);

  console.log(`Excluded ${expiredCount} expired jobs`);
  console.log(`Wrote ${jobs.length} jobs to ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
