import type { Command } from 'commander';
import {
  createEnrollmentToken,
  readEnrollmentState,
  setTrustState,
  verifyEnrollmentToken,
} from '../../src/core/enrollment.js';
import { CONTROL_PLANE_RUNTIME_ID } from '../../src/core/config.js';

function rid(): string | undefined {
  return CONTROL_PLANE_RUNTIME_ID || undefined;
}

export function registerEnrollCommand(program: Command): void {
  const enroll = program
    .command('enroll')
    .description('TOFU enrollment and out-of-band trust pairing');

  enroll
    .command('token-create')
    .description('Create one-time enrollment token (default TTL 20m, range 10-30m)')
    .option('--ttl <minutes>', 'Token TTL in minutes', '20')
    .action((opts: { ttl: string }) => {
      const ttl = Number(opts.ttl);
      const result = createEnrollmentToken({
        ttlMinutes: Number.isFinite(ttl) ? ttl : undefined,
        runtimeId: rid(),
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
    .action(() => {
      const state = readEnrollmentState(rid());
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
    .action((token: string, opts: { fingerprint?: string }) => {
      const state = readEnrollmentState(rid());
      const result = verifyEnrollmentToken({
        token,
        runtimeFingerprint: opts.fingerprint || state.runtime_fingerprint,
        runtimeId: rid(),
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
    .action(() => {
      const state = setTrustState('revoked', { runtimeId: rid() });
      console.log(`Runtime trust revoked. trust_state=${state.trust_state}`);
    });

  enroll
    .command('reenroll')
    .description('Reset to discovered_untrusted for re-enrollment')
    .action(() => {
      const state = setTrustState('discovered_untrusted', { runtimeId: rid() });
      console.log(`Runtime reset. trust_state=${state.trust_state}`);
    });
}
