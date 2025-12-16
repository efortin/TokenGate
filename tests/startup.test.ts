import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { discoverModels } from '../src/services/backend.js';

describe('startup model discovery', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should require model to be available for startup', async () => {
        // Simulate backend not responding with models
        vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

        const models = await discoverModels('http://localhost:8000');

        // When discovery fails, models array should be empty
        // This should cause startup to fail (tested in index.ts logic)
        expect(models).toEqual([]);
        expect(models.length).toBe(0);
    });

    it('should succeed discovery when backend returns models', async () => {
        const mockResponse = {
            ok: true,
            json: () => Promise.resolve({ data: [{ id: 'mistralai/Devstral-Small-2-24B' }] }),
        };
        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const models = await discoverModels('http://localhost:8000', 'api-key');

        expect(models).toEqual(['mistralai/Devstral-Small-2-24B']);
        expect(models.length).toBeGreaterThan(0);
    });

    it('should return empty array on non-ok response', async () => {
        const mockResponse = { ok: false, status: 503 };
        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const models = await discoverModels('http://localhost:8000');

        expect(models).toEqual([]);
    });

    it('should return empty array when backend returns empty model list', async () => {
        const mockResponse = {
            ok: true,
            json: () => Promise.resolve({ data: [] }),
        };
        vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

        const models = await discoverModels('http://localhost:8000');

        expect(models).toEqual([]);
    });
});
