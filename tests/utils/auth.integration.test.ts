import {describe, it, expect} from 'vitest';
import {extractEmailFromAuth, hashEmail} from '../../src/utils/auth.js';

describe('JWT Email Extraction Integration', () => {
  it('should extract and hash email from JWT', () => {
    // Simulate a JWT
    const header = Buffer.from(JSON.stringify({
      alg: 'HS256',
      typ: 'JWT'
    })).toString('base64');

    const payload = Buffer.from(JSON.stringify({
      aud: 'QDFtFvSFIWQLopuBZnVqkm4mhM',
      email: 'user@example.com',
      entity_id: 'entity_459fddaf',
      exp: 1768027836,
      iat: 1765435836,
      iss: 'https://identity-provider.com/v1/identity/oidc',
      namespace: 'root',
      sub: '90e9cdbd-194e-0973-159c-cd26c2142888'
    })).toString('base64');

    const signature = 'signature';
    const token = `${header}.${payload}.${signature}`;
    const authHeader = `Bearer ${token}`;

    // Step 1: Extract email from Authorization header
    const email = extractEmailFromAuth(authHeader);
    expect(email).toBe('user@example.com');

    // Step 2: Hash the email for use as a metric tag
    const userTag = hashEmail(email);
    expect(userTag).toMatch(/^[a-f0-9]{8}$/);

    // Step 3: Verify the hash is deterministic
    const userTag2 = hashEmail(email);
    expect(userTag).toBe(userTag2);

    // Step 4: Verify different emails produce different hashes
    const differentEmail = 'john.doe@example.com';
    const differentTag = hashEmail(differentEmail);
    expect(differentTag).not.toBe(userTag);

    // Step 5: Verify case insensitivity
    // Note: hashEmail is case-insensitive, so both should produce the same hash
    const upperCaseEmail = 'user@example.com'.toUpperCase();
    const upperCaseTag = hashEmail(upperCaseEmail);
    expect(upperCaseTag).toBe(hashEmail(email));
  });

  it('should handle missing email gracefully', () => {
    // JWT without email claim
    const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      sub: 'user-123',
      name: 'Test User',
      exp: 1768027836
    })).toString('base64');
    const token = `${header}.${payload}.signature`;
    const authHeader = `Bearer ${token}`;

    const email = extractEmailFromAuth(authHeader);
    expect(email).toBeNull();

    // Should use 'anonymous' as fallback
    const userTag = email ? hashEmail(email) : 'anonymous';
    expect(userTag).toBe('anonymous');
  });

  it('should use hashed email in metric tags', () => {
    // Simulate the complete workflow with a proper JWT
    const header = Buffer.from(JSON.stringify({alg: 'HS256'})).toString('base64');
    const payload = Buffer.from(JSON.stringify({email: 'test.user@example.com'})).toString('base64');
    const token = `${header}.${payload}.signature`;
    const authHeader = `Bearer ${token}`;

    // Extract email from request
    const extractedEmail = extractEmailFromAuth(authHeader);
    expect(extractedEmail).toBe('test.user@example.com');

    // Create user tag for metrics
    const userTag = hashEmail(extractedEmail);
    expect(userTag).toMatch(/^[a-f0-9]{8}$/);

    // Simulate metric collection
    const metricLabels = {
      user: userTag,
      model: 'devstral',
      type: 'input'
    };

    // Verify labels are valid
    expect(metricLabels.user.length).toBe(8);
    expect(metricLabels.user).toBeDefined();
    expect(metricLabels.model).toBe('devstral');
  });
});
