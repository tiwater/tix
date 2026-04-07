import type { AdaptedSkill, InstalledSkillRecord, ListedSkill, RegistryActionContext, SkillInstallOptions, SkillsConfig } from './types.js';
export declare class SkillsRegistry {
    private readonly config;
    constructor(config?: SkillsConfig);
    getConfig(): SkillsConfig;
    listAvailable(): ListedSkill[];
    getSkill(name: string): AdaptedSkill | undefined;
    getInstalled(name: string): InstalledSkillRecord | undefined;
    installSkill(nameOrSource: string, context: RegistryActionContext, options?: SkillInstallOptions): InstalledSkillRecord;
    upgradeSkill(name: string, context: RegistryActionContext, options?: SkillInstallOptions): InstalledSkillRecord;
    enableSkill(name: string, context: RegistryActionContext): InstalledSkillRecord;
    disableSkill(name: string, context: RegistryActionContext): InstalledSkillRecord;
    removeSkill(name: string, context: RegistryActionContext): InstalledSkillRecord;
    inspectSkill(name: string): ListedSkill | undefined;
    private persistDiscoveredSkill;
    private installManagedSkill;
    private buildInstalledRecord;
    private buildTrustedSource;
    private restoreInstalledSkill;
    private requireSkill;
    private assertCompatible;
    private assertManagementAllowed;
    private assertExecutableActionAllowed;
    private readState;
    private normalizeInstalledRecord;
    private writeState;
    private appendAudit;
    private managedSkillsRoot;
    private discoveryRoots;
    private loadDiscoveredSkills;
}
//# sourceMappingURL=registry.d.ts.map