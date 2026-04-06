import yaml from 'yaml';
import type {
  OpenTixSkillMetadata,
  ParsedOpenTixSkill,
  ParsedSkillSection,
  SkillDiagnostic,
} from './types.js';

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  diagnostics: SkillDiagnostic[];
} {
  const diagnostics: SkillDiagnostic[] = [];
  if (!raw.startsWith('---\n')) {
    return { frontmatter: {}, body: raw, diagnostics };
  }

  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter_unterminated',
      message:
        'SKILL.md starts with frontmatter but does not close it cleanly.',
    });
    return { frontmatter: {}, body: raw, diagnostics };
  }

  const frontmatterRaw = raw.slice(4, end);
  try {
    const parsed = yaml.parse(frontmatterRaw);
    return {
      frontmatter:
        parsed && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : {},
      body: raw.slice(end + 5),
      diagnostics,
    };
  } catch (error) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter_parse_failed',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to parse SKILL.md frontmatter.',
    });
    return { frontmatter: {}, body: raw, diagnostics };
  }
}

function extractSections(body: string): Record<string, ParsedSkillSection> {
  const sections: Record<string, ParsedSkillSection> = {};
  const lines = body.split(/\r?\n/);
  let current: ParsedSkillSection | undefined;

  for (const line of lines) {
    const headingMatch = line.match(/^##+\s+(.+?)\s*$/);
    if (headingMatch) {
      current = {
        title: headingMatch[1].trim(),
        slug: slugifyHeading(headingMatch[1]),
        body: '',
        lines: [],
      };
      sections[current.slug] = current;
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
  }

  for (const section of Object.values(sections)) {
    section.body = section.lines.join('\n').trim();
  }

  return sections;
}

function sectionLines(
  sections: Record<string, ParsedSkillSection>,
  ...aliases: string[]
): string[] {
  for (const alias of aliases) {
    const section = sections[slugifyHeading(alias)];
    if (section) return section.lines;
  }
  return [];
}

function sectionBody(
  sections: Record<string, ParsedSkillSection>,
  ...aliases: string[]
): string | undefined {
  for (const alias of aliases) {
    const section = sections[slugifyHeading(alias)];
    if (section?.body) return section.body;
  }
  return undefined;
}

function extractTitle(body: string): string {
  const titleMatch = body.match(/^#\s+(.+?)\s*$/m);
  return titleMatch?.[1]?.trim() || '';
}

function extractKeyValueLines(body: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(
      /^(name|description|version|entry|entrypoint|requires|install|permissions?|skill_api_version|skillapiversion)\s*:\s*(.+)$/i,
    );
    if (!match) continue;
    values[match[1].toLowerCase()] = match[2].trim();
  }
  return values;
}

function extractBulletList(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function extractInstallCommands(lines: string[]): string[] {
  const commands: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!line) continue;
    if (inFence) {
      commands.push(line);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      commands.push(line.replace(/^[-*]\s+/, '').trim());
    }
  }

  return commands;
}

function firstParagraph(body: string): string | undefined {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('#'));
  return paragraphs[0];
}

function buildMetadata(
  raw: string,
  body: string,
  frontmatter: Record<string, unknown>,
  sections: Record<string, ParsedSkillSection>,
): OpenTixSkillMetadata {
  const keyValues = extractKeyValueLines(body);
  const installLines = sectionLines(sections, 'install', 'installation');
  const requiresLines = sectionLines(sections, 'requires', 'dependencies');
  const permissionsLines = sectionLines(
    sections,
    'permissions',
    'permission',
    'access',
  );
  const descriptionSection = sectionBody(sections, 'description', 'overview');
  const entrySection =
    sectionBody(sections, 'entrypoint', 'entry', 'run', 'command') || '';

  const title = extractTitle(body);
  const description =
    normalizeStringValue(frontmatter.description) ||
    keyValues.description ||
    descriptionSection ||
    firstParagraph(body) ||
    title;

  const entry =
    normalizeStringValue(frontmatter.entry) ||
    normalizeStringValue(frontmatter.entrypoint) ||
    keyValues.entry ||
    keyValues.entrypoint ||
    entrySection;

  return {
    name:
      normalizeStringValue(frontmatter.name) ||
      normalizeStringValue(frontmatter.skill) ||
      keyValues.name ||
      title,
    description: description?.trim() || 'OpenTix-compatible skill',
    version:
      normalizeStringValue(frontmatter.version) ||
      keyValues.version ||
      undefined,
    skillApiVersion:
      normalizeStringValue(frontmatter.skill_api_version) ||
      normalizeStringValue(frontmatter.skillApiVersion) ||
      keyValues.skill_api_version ||
      keyValues.skillapiversion ||
      undefined,
    requires: [
      ...normalizeListValue(frontmatter.requires),
      ...normalizeListValue(keyValues.requires),
      ...extractBulletList(requiresLines),
    ],
    install: [
      ...normalizeListValue(frontmatter.install),
      ...normalizeListValue(keyValues.install),
      ...extractInstallCommands(installLines),
    ],
    permissions: [
      ...normalizeListValue(frontmatter.permissions),
      ...normalizeListValue(frontmatter.permission),
      ...normalizeListValue(keyValues.permissions),
      ...normalizeListValue(keyValues.permission),
      ...extractBulletList(permissionsLines),
    ],
    entry:
      typeof entry === 'string' && entry.includes('\n')
        ? entry
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean)
        : normalizeStringValue(entry),
    source: normalizeStringValue(frontmatter.source),
  };
}

export function parseOpenTixSkillMarkdown(raw: string): ParsedOpenTixSkill {
  const { frontmatter, body, diagnostics } = extractFrontmatter(raw);
  const sections = extractSections(body);
  const metadata = buildMetadata(raw, body, frontmatter, sections);

  if (!metadata.name) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_name',
      message: 'SKILL.md must provide a skill name or a top-level title.',
    });
  }

  if (!metadata.description) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing_description',
      message: 'SKILL.md did not provide a description; a fallback was used.',
    });
  }

  if (!metadata.entry && metadata.install.length > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'install_without_entry',
      message:
        'Install steps were found but no explicit entrypoint was declared in SKILL.md.',
    });
  }

  return {
    metadata: {
      ...metadata,
      requires: Array.from(new Set(metadata.requires)),
      install: Array.from(new Set(metadata.install)),
      permissions: Array.from(new Set(metadata.permissions)),
    },
    title: extractTitle(body),
    frontmatter,
    sections,
    diagnostics,
    raw,
  };
}
