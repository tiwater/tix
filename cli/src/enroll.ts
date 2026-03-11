import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { Command } from 'commander';
import { PROJECT_ROOT } from './utils.js';

interface EnrollmentModule {
  createEnrollmentToken: (opts: {
    ttlMinutes?: number;
    runtimeId?: string;
  }) => {
    runtime_id: string;
    runtime_fingerprint: string;
    token: string;
    expires_at: string;
  };
  readEnrollmentState: (runtimeId?: string) => {
    runtime_id: string;
    runtime_fingerprint: string;
    trust_state: string;
    token_expires_at?: string;
    failed_attempts: number;
    frozen_until?: string;
  };
  setTrustState: (
    state: string,
    opts?: { runtimeId?: string },
  ) => { trust_state: string };
  verifyEnrollmentToken: (opts: {
    token: string;
    runtimeFingerprint: string;
    runtimeId?: string;
  }) => { ok: boolean; code?: string };
}

interface ConfigModule {
  CONTROL_PLANE_RUNTIME_ID?: string;
}

async function loadBuiltModule<T>(relativePath: string): Promise<T> {
  const modulePath = path.join(PROJECT_ROOT, 'dist', ...relativePath.split('/'));
  if (!fs.existsSync(modulePath)) {
    console.error('Core module is not built yet. Run `pnpm run build` first.');
    process.exit(1);
  }
  return import(pathToFileURL(modulePath).href) as Promise<T>;
}

async function loadEnrollmentDeps(): Promise<{
  enrollment: EnrollmentModule;
  config: ConfigModule;
}> {
  const [enrollment, config] = await Promise.all([
    loadBuiltModule<EnrollmentModule>('core/enrollment.js'),
    loadBuiltModule<ConfigModule>('core/config.js'),
  ]);
  return { enrollment, config };
}

export function registerEnrollCommand(program: Command): void {
  const enroll = program
    .command('enroll')
    .description('TOFU enrollment and out-of-band trust pairing');

  enroll
    .command('token-create')
    .description('Create one-time enrollment token (default TTL 20m, range 10-30m)')
    .option('--ttl <minutes>', 'Token TTL in minutes', '20')
    .action(async (opts: { ttl: string }) => {
      const ttl = Number(opts.ttl);
      const { enrollment, config } = await loadEnrollmentDeps();
      const result = enrollment.createEnrollmentToken({
        ttlMinutes: Number.isFinite(ttl) ? ttl : undefined,
        runtimeId: config.CONTROL_PLANE_RUNTIME_ID || undefined,
      });

      console.log('Enrollment token created:');
      console.log(`  runtime_id: ${result.runtime_id}`);
      console.log(`  runtime_fingerprint: ${result.runtime_fingerprint}`);
      console.log(`  token: ${result.token}`);
      console.log(`  expires_at: ${result.expires_at}`);
      console.log('\nShare token out-of-band with control-plane admin.');
    });

  enroll
    .command('status')
    .description('Show current enrollment/trust status')
    .action(async () => {
      const { enrollment, config } = await loadEnrollmentDeps();
      const state = enrollment.readEnrollmentState(
        config.CONTROL_PLANE_RUNTIME_ID || undefined,
      );
      console.log('Enrollment status:');
      console.log(`  runtime_id: ${state.runtime_id}`);
      console.log(`  runtime_fingerprint: ${state.runtime_fingerprint}`);
      console.log(`  trust_state: ${state.trust_state}`);
      console.log(`  token_expires_at: ${state.token_expires_at || 'none'}`);
      console.log(`  failed_attempts: ${state.failed_attempts}`);
      if (state.frozen_until) {
        console.log(`  frozen_until: ${state.frozen_until}`);
      }
    });

  enroll
    .command('verify')
    .description('Verify enrollment token locally (for test/integration)')
    .argument('<token>', 'Enrollment token')
    .option('--fingerprint <fp>', 'Runtime fingerprint override')
    .action(async (token: string, opts: { fingerprint?: string }) => {
      const { enrollment, config } = await loadEnrollmentDeps();
      const state = enrollment.readEnrollmentState(
        config.CONTROL_PLANE_RUNTIME_ID || undefined,
      );
      const result = enrollment.verifyEnrollmentToken({
        token,
        runtimeFingerprint: opts.fingerprint || state.runtime_fingerprint,
        runtimeId: config.CONTROL_PLANE_RUNTIME_ID || undefined,
      });

      if (!result.ok) {
        console.error(`Verification failed: ${result.code}`);
        process.exit(1);
      }
      console.log('Verification succeeded. trust_state=trusted');
    });

  enroll
    .command('revoke')
    .description('Revoke trust for this runtime')
    .action(async () => {
      const { enrollment, config } = await loadEnrollmentDeps();
      const state = enrollment.setTrustState('revoked', {
        runtimeId: config.CONTROL_PLANE_RUNTIME_ID || undefined,
      });
      console.log(`Runtime trust revoked. trust_state=${state.trust_state}`);
    });

  enroll
    .command('reenroll')
    .description('Reset to discovered_untrusted for re-enrollment')
    .action(async () => {
      const { enrollment, config } = await loadEnrollmentDeps();
      const state = enrollment.setTrustState('discovered_untrusted', {
        runtimeId: config.CONTROL_PLANE_RUNTIME_ID || undefined,
      });
      console.log(`Runtime reset. trust_state=${state.trust_state}`);
    });
}
