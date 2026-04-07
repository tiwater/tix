import type { DiscoveredSkill, FailedSkillLoad, ManagedSkillManifest, SkillApiCompatibility, SkillEntrypoint, SkillSourceReference } from './types.js';
export declare const CURRENT_SKILL_API_VERSION = "1.0.0";
export declare const MANAGED_SKILL_MANIFEST = ".tix-skill.json";
export interface MaterializedSkillSource {
    sourceRef: SkillSourceReference;
    workspaceDir: string;
    skillDir: string;
}
export declare function resolveSkillApiCompatibility(declared?: string, current?: string): SkillApiCompatibility;
export declare function resolveSkillSourceSpec(spec: string): SkillSourceReference;
export declare function materializeSkillSource(spec: string, options?: {
    proxy?: string;
}): MaterializedSkillSource;
export declare function hashSkillDirectory(skillDir: string): string;
export declare function writeManagedSkillManifest(skillDir: string, manifest: ManagedSkillManifest): void;
export declare function detectSkillEntrypoint(skillDir: string, declaredEntry?: string): SkillEntrypoint | undefined;
export declare function loadOpenTixSkillFromDirectory(skillDir: string): DiscoveredSkill;
export declare function discoverOpenTixSkillDirectories(skillRoots: string[]): string[];
export declare function loadOpenTixSkillsDetailed(skillRoots: string[]): {
    skills: DiscoveredSkill[];
    failures: FailedSkillLoad[];
};
export declare function loadOpenTixSkills(skillRoots: string[]): DiscoveredSkill[];
//# sourceMappingURL=loader.d.ts.map